import type { Channel, Category } from '@/types/playlist'
import { isAdultLabel } from './adult-content'
import { perfMark } from './perf'

// Startup blocks on this: a 2-minute ceiling meant one unreachable playlist URL
// pinned the "Kaynaklar bağlanıyor..." screen for two minutes with no feedback.
// So the server gets 30 s to answer; after that the body may take as long as
// it needs, but must not stall for more than 30 s.
const M3U_HEADERS_TIMEOUT_MS = 30_000
const M3U_BODY_IDLE_TIMEOUT_MS = 30_000
// Real playlists with 100k+ entries run past 20 MB. Until parsing moves to a
// worker (F4-04) the whole text still has to fit in renderer memory, so the
// cap stays, just far above real lists.
const MAX_M3U_SIZE_BYTES = 128 * 1024 * 1024
const MAX_M3U_SIZE_LABEL = '128 MB'
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
  if (quotedMatch) return quotedMatch[1]
  const unquotedMatch = unquoted.exec(section)
  return unquotedMatch ? unquotedMatch[1] : ''
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

/**
 * Parse M3U/M3U8 playlist text. Pure and synchronous (no DOM, no fetch), so
 * it can run unchanged inside a worker.
 *
 * Channel ids hash the stream URL. When the same URL appears more than once
 * (one stream listed in two groups), the first entry keeps the plain hash id
 * so existing favorites and history stay valid, and each later one gets a
 * deterministic `_<n>` suffix (n = 2, 3, ...) in playlist order.
 */
export function parseM3U(content: string, sourceId: string): { channels: Channel[]; categories: Category[] } {
  perfMark('m3u:parse-start', { chars: content.length })
  const channels: Channel[] = []
  const groupStats = new Map<string, GroupStats>()
  const idCounts = new Map<string, number>()
  let current: ExtInf | null = null
  let pendingGroup: string | null = null

  const addChannel = (meta: ExtInf, url: string): void => {
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
      isAdult: isAdultLabel(name)
    })
  }

  // Walk the text line by line with indexOf instead of split(): no array of
  // every line is ever built.
  const length = content.length
  let pos = 0
  while (pos < length) {
    let lineEnd = content.indexOf('\n', pos)
    if (lineEnd === -1) lineEnd = length
    // trim() also drops '\r' and a leading BOM.
    const line = content.slice(pos, lineEnd).trim()
    pos = lineEnd + 1

    if (!line) continue

    if (line.startsWith('#EXTINF:')) {
      current = parseExtInf(line)
    } else if (line.startsWith('#EXTGRP:')) {
      // #EXTGRP provides the group name as an alternative to group-title.
      pendingGroup = line.substring(8).trim()
    } else if (line.startsWith('#')) {
      continue
    } else if (current) {
      if (!current.group && pendingGroup) current.group = pendingGroup
      addChannel(current, line)
      current = null
      pendingGroup = null
    } else {
      // URL without EXTINF: minimal entry named after the file.
      addChannel({ name: cleanUrlName(line), logo: '', group: pendingGroup || '', tvgId: '', tvgName: '' }, line)
      pendingGroup = null
    }
  }

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

  perfMark('m3u:parse-done', { channels: channels.length })
  return { channels, categories }
}

function playlistTooLargeError(): Error {
  return new Error(`Liste boyutu çok büyük (en fazla ${MAX_M3U_SIZE_LABEL})`)
}

async function readResponseTextWithLimit(
  response: Response,
  maxSizeBytes: number,
  onProgress: () => void
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (text.length > maxSizeBytes) throw playlistTooLargeError()
    return text
  }

  const streamReader = reader
  const decoder = new TextDecoder()
  const parts: string[] = []
  async function readNext(totalSize: number): Promise<void> {
    const { done, value } = await streamReader.read()
    if (done) return
    onProgress()

    const nextSize = totalSize + value.length
    if (nextSize > maxSizeBytes) {
      await streamReader.cancel()
      throw playlistTooLargeError()
    }
    parts.push(decoder.decode(value, { stream: true }))
    await readNext(nextSize)
  }

  await readNext(0)
  parts.push(decoder.decode())
  return parts.join('')
}

export async function fetchAndParseM3U(url: string, sourceId: string): Promise<ReturnType<typeof parseM3U>> {
  const parsedUrl = new URL(url)
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Yalnızca HTTP/HTTPS oynatma listesi adresleri destekleniyor')
  }

  const controller = new AbortController()
  let timedOut = false
  let timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, M3U_HEADERS_TIMEOUT_MS)
  const restartIdleTimer = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, M3U_BODY_IDLE_TIMEOUT_MS)
  }

  try {
    const res = await fetch(parsedUrl.toString(), { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`M3U listesi indirilemedi (HTTP ${res.status})`)
    restartIdleTimer()
    const content = await readResponseTextWithLimit(res, MAX_M3U_SIZE_BYTES, restartIdleTimer)
    clearTimeout(timer)
    return parseM3U(content, sourceId)
  } catch (error) {
    if (timedOut) throw new Error('M3U listesi indirilirken zaman aşımı oluştu', { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
  }
}
