import { itemAt } from '../../../shared/checked'
import type { Channel, Category } from '@/types/playlist'
import { isAdultLabel } from './adult-content'
import { requestHost } from './xtream-errors'
import { requests } from '@/strings/requests'
import type { StreamHttpHeaders } from '../../../shared/playback'
import {
  emptyPendingHeaders,
  finishHeaders,
  readExtInfHeaders,
  readHeaderDirective,
  splitUrlHeaders
} from './m3u-headers'

// Startup blocks on this: a 2-minute ceiling meant one unreachable playlist URL
// pinned the "Kaynaklar bağlanıyor..." screen for two minutes with no feedback.
// So the server gets 30 s to answer; after that the body may take as long as
// it needs, but must not stall for more than 30 s.
const M3U_HEADERS_TIMEOUT_MS = 30_000
const M3U_BODY_IDLE_TIMEOUT_MS = 30_000
// No size limit: the text is parsed line by line as it arrives (in the
// catalog worker), so no whole-playlist string is ever built.
const VOD_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv'])

type ContentType = 'live' | 'vod' | 'series'

interface ExtInf {
  name: string
  logo: string
  group: string
  tvgId: string
  tvgName: string
}

function attributePatterns(attr: string): [RegExp, RegExp] {
  // Quoted first: tvg-id="value"; then unquoted: tvg-id=value (ends at a
  // space or comma).
  return [new RegExp(`${attr}="([^"]*)"`), new RegExp(`${attr}=([^"\\s,]+)`)]
}

// Compiled once: a 100k-entry playlist would otherwise build 400k RegExps.
const TVG_ID = attributePatterns('tvg-id')
const TVG_NAME = attributePatterns('tvg-name')
const TVG_LOGO = attributePatterns('tvg-logo')
const GROUP_TITLE = attributePatterns('group-title')

function extractAttribute(section: string, [quoted, unquoted]: [RegExp, RegExp]): string {
  const quotedMatch = quoted.exec(section)
  if (quotedMatch) return itemAt(quotedMatch, 1)
  const unquotedMatch = unquoted.exec(section)
  return unquotedMatch ? itemAt(unquotedMatch, 1) : ''
}

/**
 * Index of the comma that ends the attribute section of an EXTINF line: the
 * first comma outside double quotes. Everything after it is the channel name,
 * commas included ("Film, Bölüm 2").
 */
function findNameSeparator(line: string): number {
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line.charCodeAt(i)
    if (ch === 34 /* " */) inQuotes = !inQuotes
    else if (ch === 44 /* , */ && !inQuotes) return i
  }
  return -1
}

export function parseExtInf(line: string): ExtInf {
  const separator = findNameSeparator(line)
  const section = separator === -1 ? line : line.slice(0, separator)
  return {
    name: separator === -1 ? '' : line.slice(separator + 1).trim(),
    tvgId: extractAttribute(section, TVG_ID),
    tvgName: extractAttribute(section, TVG_NAME),
    logo: extractAttribute(section, TVG_LOGO),
    group: extractAttribute(section, GROUP_TITLE)
  }
}

/** Lowercased extension of the URL's last path segment, without query or fragment. */
function urlExtension(url: string): string {
  let end = url.length
  const query = url.indexOf('?')
  if (query !== -1) end = query
  const hash = url.indexOf('#')
  if (hash !== -1 && hash < end) end = hash
  const dot = url.lastIndexOf('.', end - 1)
  if (dot === -1 || dot < url.lastIndexOf('/', end - 1)) return ''
  return url.slice(dot + 1, end).toLowerCase()
}

function cleanUrlName(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const lastSegment = pathname.split('/').pop() || ''
    // Remove extension
    const dotIdx = lastSegment.lastIndexOf('.')
    const name = dotIdx > 0 ? lastSegment.substring(0, dotIdx) : lastSegment
    return name || 'Bilinmeyen'
  } catch {
    // Fallback for non-URL strings
    const segment = url.split('/').pop() || 'Bilinmeyen'
    const qIdx = segment.indexOf('?')
    const clean = qIdx > 0 ? segment.substring(0, qIdx) : segment
    const dotIdx = clean.lastIndexOf('.')
    return dotIdx > 0 ? clean.substring(0, dotIdx) : clean || 'Bilinmeyen'
  }
}

function hashHex(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableGroupId(sourceId: string, groupName: string): string {
  // Hash of the group name, stable across playlist refreshes.
  return `${sourceId}_m3u_${hashHex(groupName)}`
}

function stableChannelId(sourceId: string, url: string): string {
  return `${sourceId}_m3u_ch_${hashHex(url)}`
}

/** Per-group facts collected during the single pass, enough to decide the group type. */
interface GroupStats {
  count: number
  vodCount: number
  hasSeriesPath: boolean
  hasMoviePath: boolean
}

function detectCategoryType(groupName: string, stats: GroupStats): ContentType {
  const lower = groupName.toLowerCase()

  if (/\b(series?|dizi|diziler|sezon|season)\b/.test(lower)) return 'series'
  if (/\b(vod|movies?|films?|filmler|sinema|cinema)\b/.test(lower)) return 'vod'

  if (stats.hasSeriesPath) return 'series'
  if (stats.hasMoviePath) return 'vod'
  if (stats.vodCount > stats.count * 0.5) return 'vod'

  return 'live'
}

function detectChannelType(url: string): ContentType {
  if (/\/series\//i.test(url)) return 'series'
  if (/\/movie\//i.test(url)) return 'vod'
  if (VOD_EXTENSIONS.has(urlExtension(url))) return 'vod'
  return 'live'
}


export interface ParsedPlaylist {
  channels: Channel[]
  categories: Category[]
  /**
   * Guide URLs from the `#EXTM3U` header (`url-tvg`, `x-tvg-url`), http(s)
   * only. They often carry the account's credentials, like the entry URLs.
   */
  epgUrls: string[]
}

const HEADER_EPG_ATTRIBUTES = [attributePatterns('url-tvg'), attributePatterns('x-tvg-url')]

/** `url-tvg` / `x-tvg-url` of an `#EXTM3U` line; either may list several URLs separated by commas. */
export function parseHeaderEpgUrls(line: string): string[] {
  const urls: string[] = []
  for (const patterns of HEADER_EPG_ATTRIBUTES) {
    const value = extractAttribute(line, patterns)
    for (const part of value.split(',')) {
      const url = part.trim()
      if (/^https?:\/\/\S+$/i.test(url) && !urls.includes(url)) urls.push(url)
    }
  }
  return urls
}

/**
 * Incremental M3U/M3U8 parser: `feed` takes text in pieces of any size (a
 * line may span two pieces), `end` returns the result. Pure and synchronous
 * (no DOM, no fetch): runs in the catalog worker.
 *
 * Channel ids hash the stream URL. When the same URL appears more than once
 * (one stream listed in two groups), the first entry keeps the plain hash id
 * so existing favorites and history stay valid, and each later one gets a
 * deterministic `_<n>` suffix (n = 2, 3, ...) in playlist order.
 */
export function createM3uParser(sourceId: string): { feed(text: string): void; end(): ParsedPlaylist } {
  const channels: Channel[] = []
  const groupStats = new Map<string, GroupStats>()
  const idCounts = new Map<string, number>()
  const epgUrls: string[] = []
  let current: ExtInf | null = null
  let pendingGroup: string | null = null
  // Request headers named for the entry being read (see m3u-headers.ts).
  // Kept until the entry's URL: such lines stand before or after `#EXTINF`.
  const pendingHeaders = emptyPendingHeaders()
  let carry = ''
  let sawHeader = false

  const addChannel = (meta: ExtInf, url: string, httpHeaders: StreamHttpHeaders | undefined): void => {
    const baseId = stableChannelId(sourceId, url)
    const seen = idCounts.get(baseId) ?? 0
    idCounts.set(baseId, seen + 1)

    const name = meta.name || meta.tvgName || 'Bilinmeyen'
    const group = meta.group

    if (group) {
      let stats = groupStats.get(group)
      if (!stats) {
        stats = { count: 0, vodCount: 0, hasSeriesPath: false, hasMoviePath: false }
        groupStats.set(group, stats)
      }
      stats.count += 1
      if (!stats.hasSeriesPath && /\/series\//i.test(url)) stats.hasSeriesPath = true
      if (!stats.hasMoviePath && /\/movie\//i.test(url)) stats.hasMoviePath = true
      if (VOD_EXTENSIONS.has(urlExtension(url))) stats.vodCount += 1
    }

    channels.push({
      id: seen === 0 ? baseId : `${baseId}_${seen + 1}`,
      name,
      logo: meta.logo || undefined,
      streamUrl: url,
      sourceId,
      // categoryId and type of grouped entries depend on the whole group, so
      // they are filled in once the pass is done.
      categoryId: undefined,
      categoryName: group || undefined,
      epgChannelId: meta.tvgId || undefined,
      group: group || undefined,
      type: group ? 'live' : detectChannelType(url),
      isAdult: isAdultLabel(name),
      ...(httpHeaders ? { httpHeaders } : {})
    })
  }

  const handleLine = (raw: string): void => {
    // trim() also drops '\r' and a leading BOM.
    const line = raw.trim()
    if (!line) return

    if (line.startsWith('#EXTINF:')) {
      current = parseExtInf(line)
      readExtInfHeaders(line, pendingHeaders)
    } else if (line.startsWith('#EXTGRP:')) {
      // #EXTGRP provides the group name as an alternative to group-title.
      pendingGroup = line.substring(8).trim()
    } else if (line.startsWith('#EXTM3U')) {
      if (!sawHeader) {
        sawHeader = true
        for (const url of parseHeaderEpgUrls(line)) epgUrls.push(url)
      }
    } else if (line.startsWith('#')) {
      readHeaderDirective(line, pendingHeaders)
      return
    } else {
      // `url|User-Agent=...`: the address ends at the bar.
      const url = splitUrlHeaders(line, pendingHeaders)
      const httpHeaders = finishHeaders(pendingHeaders)
      pendingHeaders.userAgent = undefined
      pendingHeaders.referer = undefined
      pendingHeaders.origin = undefined
      if (current) {
        if (!current.group && pendingGroup) current.group = pendingGroup
        addChannel(current, url, httpHeaders)
        current = null
      } else {
        // URL without EXTINF: minimal entry named after the file.
        addChannel({ name: cleanUrlName(url), logo: '', group: pendingGroup || '', tvgId: '', tvgName: '' }, url, httpHeaders)
      }
      pendingGroup = null
    }
  }

  return {
    feed(text) {
      // Walk with indexOf instead of split(): no array of every line is built,
      // and only the unfinished last line is kept for the next piece.
      const content = carry ? carry + text : text
      let pos = 0
      for (;;) {
        const lineEnd = content.indexOf('\n', pos)
        if (lineEnd === -1) break
        handleLine(content.slice(pos, lineEnd))
        pos = lineEnd + 1
      }
      carry = content.slice(pos)
    },

    end() {
      if (carry) handleLine(carry)
      carry = ''

      const categories: Category[] = []
      const groupInfo = new Map<string, { id: string; type: ContentType; adult: boolean }>()
      for (const [groupName, stats] of groupStats) {
        const info = {
          id: stableGroupId(sourceId, groupName),
          type: detectCategoryType(groupName, stats),
          // M3U has no adult flag of its own, so it is resolved from the labels
          // here, once, instead of on the sort path.
          adult: isAdultLabel(groupName)
        }
        groupInfo.set(groupName, info)
        categories.push({ id: info.id, name: groupName, sourceId, type: info.type })
      }

      for (const channel of channels) {
        if (!channel.group) continue
        const info = groupInfo.get(channel.group)
        if (!info) continue
        channel.categoryId = info.id
        channel.type = info.type
        if (info.adult) channel.isAdult = true
      }

      return { channels, categories, epgUrls }
    }
  }
}

/** Parse M3U/M3U8 playlist text in one go. See `createM3uParser`. */
export function parseM3U(content: string, sourceId: string): ParsedPlaylist {
  const parser = createM3uParser(sourceId)
  parser.feed(content)
  return parser.end()
}

export type PlaylistErrorKind = 'network' | 'timeout' | 'http' | 'aborted' | 'bad-response' | 'certificate'

/**
 * A failed playlist (or guide) download. `kind` is what the user-error mapper
 * reads; `host` lets a network failure be matched against a certificate main
 * refused. The message is Turkish and never holds the URL.
 */
export class PlaylistRequestError extends Error {
  readonly kind: PlaylistErrorKind
  readonly status?: number
  readonly host?: string

  constructor(kind: PlaylistErrorKind, message: string, options: { status?: number; host?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'PlaylistRequestError'
    this.kind = kind
    if (options.status !== undefined) this.status = options.status
    if (options.host) this.host = options.host
  }
}

export interface StreamTextOptions {
  signal?: AbortSignal
  headersTimeoutMs?: number
  bodyIdleTimeoutMs?: number
  /** Total bytes received so far, after every piece. */
  onProgress?: (bytes: number) => void
  /** Message for a non-2xx answer. */
  httpMessage: (status: number) => string
  timeoutMessage: string
}

/**
 * Downloads a text body and hands it on piece by piece, decoded, without ever
 * holding all of it: headers within `headersTimeoutMs`, then the body may
 * take as long as it needs but must not stall longer than `bodyIdleTimeoutMs`.
 */
export async function streamText(url: string, onText: (text: string) => void, options: StreamTextOptions): Promise<void> {
  const host = requestHost(url)
  const controller = new AbortController()
  let timedOut = false
  const signal = options.signal

  const failure = (error: unknown): Error => {
    if (error instanceof PlaylistRequestError) return error
    if (timedOut) return new PlaylistRequestError('timeout', options.timeoutMessage, { host, cause: error })
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return new PlaylistRequestError('aborted', requests.cancelled, { host, cause: error })
    }
    return new PlaylistRequestError('network', requests.playlist.unreachable, { host, cause: error })
  }

  const abortFromCaller = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abortFromCaller, { once: true })
  }
  let timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.headersTimeoutMs ?? M3U_HEADERS_TIMEOUT_MS)
  const restartIdleTimer = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.bodyIdleTimeoutMs ?? M3U_BODY_IDLE_TIMEOUT_MS)
  }

  try {
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    } catch (error) {
      throw failure(error)
    }
    if (!res.ok) {
      res.body?.cancel().catch(() => undefined)
      throw new PlaylistRequestError('http', options.httpMessage(res.status), { status: res.status, host })
    }
    restartIdleTimer()
    const reader = res.body?.getReader()
    if (!reader) {
      onText(await res.text())
      return
    }
    const decoder = new TextDecoder()
    let bytes = 0
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (error) {
        throw failure(error)
      }
      if (chunk.done) break
      restartIdleTimer()
      bytes += chunk.value.length
      onText(decoder.decode(chunk.value, { stream: true }))
      options.onProgress?.(bytes)
    }
    // A cancelled reader reports `done`, which must not pass for a full body.
    if (controller.signal.aborted) throw failure(new DOMException('Aborted', 'AbortError'))
    const rest = decoder.decode()
    if (rest) onText(rest)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

function checkPlaylistUrl(url: string): URL {
  const parsedUrl = new URL(url)
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(requests.playlist.httpOnly)
  }
  return parsedUrl
}

/** Downloads and parses a playlist in this thread, streamed. The worker's M3U job runs this. */
export async function fetchM3uStreamed(
  url: string,
  sourceId: string,
  options: { signal?: AbortSignal; onProgress?: (bytes: number) => void } = {}
): Promise<ParsedPlaylist> {
  const parsedUrl = checkPlaylistUrl(url)
  const parser = createM3uParser(sourceId)
  await streamText(parsedUrl.toString(), (text) => parser.feed(text), {
    ...options,
    httpMessage: requests.playlist.downloadFailed,
    timeoutMessage: requests.playlist.timeout
  })
  return parser.end()
}

