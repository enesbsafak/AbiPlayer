// A local fake IPTV provider: Xtream Codes API, M3U, XMLTV, live MPEG-TS and
// HLS, VOD files with Range support, and artwork. Everything the app fetches
// from a provider, served from 127.0.0.1 with configurable latency, bandwidth,
// CORS and failure injection.

import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { AddressInfo, Socket } from 'node:net'
import { dirname, join } from 'node:path'
import {
  CATALOG_PRESETS,
  generateCatalog,
  seriesInfo,
  vodInfo,
  type Catalog,
  type CatalogPreset,
  type CatalogSize,
  type Json
} from './catalog.ts'
import { DEMO_ASSETS_DIR, demoGuide, demoLogoSvg, demoSeriesInfo, demoVodInfo, generateDemoCatalog } from './demo.ts'
import { liveMediaIn, type MediaSet } from './media.ts'
import { artworkPng } from './png.ts'
import { generateSelfSignedCertificate, type GeneratedCertificate } from '../../src/main/tls/testing/self-signed.ts'
import { itemAt } from '../../src/shared/checked.ts'

export type FailureMode =
  | 'timeout'
  | 'http-401'
  | 'http-403'
  | 'http-404'
  | 'http-500'
  | 'http-503'
  | 'wrong-shape'
  | 'html'
  | 'empty-body'
  | 'drop'
  | 'reset'
  | 'end'

export interface FailureRule {
  /**
   * Route key: 'auth', an Xtream action ('get_live_streams', ...), 'live-ts',
   * 'live-hls', 'hls-segment', 'movie', 'series-episode', 'xmltv', 'm3u',
   * 'img', or '*' for everything.
   */
  route: string
  mode: FailureMode
  /**
   * 'drop': close the connection this long after the response starts.
   * 'end' (live TS only): finish the response cleanly this long after it
   * starts, as a panel does when it restarts a channel; a clean end of file,
   * not a network error.
   */
  afterMs?: number
  /** Only the first N matching requests fail; unlimited when omitted. */
  times?: number
}

export type AuthBehaviour = 'ok' | 'wrong-credentials' | 'auth-as-string' | 'expired'

export interface MockConfig {
  username: string
  password: string
  /** Added before every response (not to /__mock/*). */
  latencyMs: number
  /** Per-connection throttle for every body, streams included. null = unthrottled. */
  bandwidthBytesPerSec: number | null
  /** Permissive CORS headers, as most panels send them. */
  cors: boolean
  auth: AuthBehaviour
  failures: FailureRule[]
  /** Seconds of live TS sent at once before pacing starts, as real panels do. */
  liveBurstSeconds: number
}

export interface MockOptions extends Partial<MockConfig> {
  host?: string
  port?: number
  size?: CatalogPreset | CatalogSize
  media: MediaSet
  seed?: number
  /**
   * HTTPS mode: true serves a self-signed certificate made at start for
   * 127.0.0.1 and localhost; or pass the certificate to serve.
   */
  tls?: boolean | GeneratedCertificate
  /** The small made-up catalog of demo.ts, with its posters, logos and guide (README screenshots). */
  demo?: boolean
  /** A folder with another live clip of the same length, live.ts and hls/ (the demo's full-HD one). */
  liveDir?: string
}

export interface RequestRecord {
  route: string
  status: number
  at: number
  bytes: number
  /** What the client sent, for the scenarios that check request headers. */
  userAgent?: string
  referer?: string
}

/** The request headers the M3U list names for its first live channel. */
export const M3U_FIRST_CHANNEL_HEADERS = { userAgent: 'AbiTest/1.0 (liste)', referer: 'http://site.example/izle' }

export interface MockStats {
  counts: Record<string, number>
  activeStreams: number
  maxConcurrentStreams: number
  recent: RequestRecord[]
}

export interface MockProvider {
  /** Base URL to type into the app's "Sunucu URL" field. */
  url: string
  port: number
  username: string
  password: string
  catalog: Catalog
  config: MockConfig
  m3uUrl(output?: 'ts' | 'm3u8'): string
  update(patch: Partial<MockConfig>): void
  stats(): MockStats
  resetStats(): void
  close(): Promise<void>
  /** The certificate served in HTTPS mode, null over plain HTTP. */
  certificate: GeneratedCertificate | null
  /**
   * HTTPS mode: serves another certificate from now on and drops open
   * connections, so the next request makes a new handshake.
   */
  setCertificate(next: GeneratedCertificate): void
}

const STREAM_ROUTES = new Set(['live-ts', 'live-hls', 'hls-segment', 'movie', 'series-episode'])
const HLS_WINDOW = 5

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function parseHlsDurations(media: MediaSet): number[] {
  try {
    const index = readFileSync(join(dirname(itemAt(media.hlsSegments, 0)), 'index.m3u8'), 'utf8')
    const durations = [...index.matchAll(/#EXTINF:([\d.]+)/g)].map((match) => Number(match[1]))
    if (durations.length === media.hlsSegments.length) return durations
  } catch {
    // fall through
  }
  return media.hlsSegments.map(() => media.hlsSegmentSeconds)
}

function xmltvTime(epochMs: number): string {
  const date = new Date(epochMs + 3 * 3600_000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0300`
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function startMockProvider(options: MockOptions): Promise<MockProvider> {
  const config: MockConfig = {
    username: options.username ?? 'abitest',
    password: options.password ?? 'Sifre2026',
    latencyMs: options.latencyMs ?? 0,
    bandwidthBytesPerSec: options.bandwidthBytesPerSec ?? null,
    cors: options.cors ?? true,
    auth: options.auth ?? 'ok',
    failures: options.failures ?? [],
    liveBurstSeconds: options.liveBurstSeconds ?? 1
  }
  const size = typeof options.size === 'object' ? options.size : CATALOG_PRESETS[options.size ?? 'small']
  const media = options.liveDir ? { ...options.media, ...liveMediaIn(options.liveDir) } : options.media
  const sockets = new Set<Socket>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const failureUses = new Map<FailureRule, number>()
  const serialized = new Map<string, Buffer>()
  const files = new Map<string, Buffer>()
  const artwork = new Map<string, Buffer>()
  const startedAt = Date.now()
  const hlsDurations = parseHlsDurations(media)
  const hlsTarget = Math.ceil(Math.max(...hlsDurations))

  let counts: Record<string, number> = {}
  let recent: RequestRecord[] = []
  let activeStreams = 0
  let maxConcurrentStreams = 0
  let baseUrl = ''
  let catalog: Catalog | null = null

  const file = (path: string) => {
    let buffer = files.get(path)
    if (!buffer) {
      buffer = readFileSync(path)
      files.set(path, buffer)
    }
    return buffer
  }

  const later = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, ms)
    timers.add(timer)
    return timer
  }

  function cached(key: string, build: () => Json | string): Buffer {
    let buffer = serialized.get(key)
    if (!buffer) {
      const value = build()
      buffer = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
      serialized.set(key, buffer)
    }
    return buffer
  }

  function failureFor(route: string): FailureRule | null {
    for (const rule of config.failures) {
      if (rule.route !== route && rule.route !== '*') continue
      const used = failureUses.get(rule) ?? 0
      if (rule.times !== undefined && used >= rule.times) continue
      failureUses.set(rule, used + 1)
      return rule
    }
    return null
  }

  function headers(res: ServerResponse, contentType: string, extra: Record<string, string | number> = {}) {
    if (config.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'no-store')
    for (const [key, value] of Object.entries(extra)) res.setHeader(key, value)
  }

  /** Writes a body, throttled to the configured bandwidth when there is one. */
  function send(res: ServerResponse, body: Buffer, record: RequestRecord): void {
    record.bytes = body.length
    const rate = config.bandwidthBytesPerSec
    if (!rate || body.length <= rate / 20) {
      res.end(body)
      return
    }
    const tickMs = 50
    const perTick = Math.max(1024, Math.floor((rate * tickMs) / 1000))
    let offset = 0
    const pump = () => {
      if (res.destroyed) return
      const next = body.subarray(offset, offset + perTick)
      offset += next.length
      if (offset >= body.length) {
        res.end(next)
        return
      }
      res.write(next)
      later(tickMs, pump)
    }
    pump()
  }

  function applyFailure(rule: FailureRule, res: ServerResponse, record: RequestRecord): boolean {
    switch (rule.mode) {
      case 'timeout':
        record.status = 0
        return true // never answer; the socket is destroyed on close()
      case 'reset':
        record.status = 0
        res.socket?.destroy()
        return true
      case 'http-401':
      case 'http-403':
      case 'http-404':
      case 'http-500':
      case 'http-503': {
        const status = Number(rule.mode.slice(5))
        record.status = status
        res.statusCode = status
        headers(res, 'text/plain; charset=utf-8')
        res.end(`Mock failure ${status}`)
        return true
      }
      case 'html':
        record.status = 200
        headers(res, 'text/html; charset=utf-8')
        res.end('<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>')
        return true
      case 'empty-body':
        record.status = 200
        headers(res, 'application/json')
        res.end('')
        return true
      case 'wrong-shape':
        record.status = 200
        headers(res, 'application/json')
        // Panels answer an unknown or failed action with an object instead of the list.
        res.end(JSON.stringify(record.route === 'auth' ? { user_info: {} } : {}))
        return true
      case 'drop':
      case 'end':
        return false // handled by the stream writer
    }
  }

  function credentialsOk(user: string | null, pass: string | null): boolean {
    if (config.auth === 'wrong-credentials') return false
    return user === config.username && pass === config.password
  }

  function authBody(): Json {
    const now = Math.floor(Date.now() / 1000)
    const auth: Json = config.auth === 'auth-as-string' ? '1' : 1
    const host = new URL(baseUrl)
    return {
      user_info: {
        username: config.username,
        password: config.password,
        message: 'Abi Player sahte sağlayıcı',
        auth,
        status: config.auth === 'expired' ? 'Expired' : 'Active',
        exp_date: config.auth === 'expired' ? String(now - 86_400) : String(now + 365 * 86_400),
        is_trial: '0',
        active_cons: '0',
        created_at: String(now - 400 * 86_400),
        max_connections: '1',
        allowed_output_formats: ['m3u8', 'ts', 'rtmp']
      },
      server_info: {
        url: host.hostname,
        port: host.port,
        https_port: '443',
        server_protocol: 'http',
        rtmp_port: '8880',
        timezone: 'Europe/Istanbul',
        timestamp_now: now,
        time_now: new Date().toISOString().replace('T', ' ').slice(0, 19),
        process: true
      }
    }
  }

  function playerApi(params: URLSearchParams, res: ServerResponse, record: RequestRecord): void {
    const action = params.get('action')
    record.route = action || 'auth'
    const rule = failureFor(record.route)
    if (rule && applyFailure(rule, res, record)) return
    if (!catalog) throw new Error('catalog not ready')
    const current = catalog

    if (!credentialsOk(params.get('username'), params.get('password'))) {
      // What real panels send for a bad login, for every action.
      headers(res, 'application/json')
      record.status = 200
      send(res, Buffer.from(JSON.stringify({ user_info: { auth: 0 } })), record)
      return
    }

    const categoryId = params.get('category_id')
    let body: Buffer
    const byCategory = (key: string, items: Json[], categoryOf: string[]) =>
      cached(`${key}:${categoryId ?? '*'}`, () =>
        categoryId === null ? items : items.filter((_item, index) => categoryOf[index] === categoryId)
      )

    switch (action) {
      case null:
      case '':
        body = Buffer.from(JSON.stringify(authBody()))
        break
      case 'get_live_categories':
        body = cached('live-categories', () => current.liveCategories)
        break
      case 'get_vod_categories':
        body = cached('vod-categories', () => current.vodCategories)
        break
      case 'get_series_categories':
        body = cached('series-categories', () => current.seriesCategories)
        break
      case 'get_live_streams':
        body = byCategory('live', current.live, current.liveCategoryOf)
        break
      case 'get_vod_streams':
        body = byCategory('vod', current.vod, current.vodCategoryOf)
        break
      case 'get_series':
        body = byCategory('series', current.series, current.seriesCategoryOf)
        break
      case 'get_series_info': {
        const seriesId = Number(params.get('series_id'))
        const info = current.demo ? demoSeriesInfo(current, seriesId) : seriesInfo(current, seriesId, baseUrl)
        // Panels return an empty list, not a 404, for an unknown id.
        body = Buffer.from(JSON.stringify(info ?? []))
        break
      }
      case 'get_vod_info': {
        const vodId = Number(params.get('vod_id'))
        const info = current.demo ? demoVodInfo(current, vodId) : vodInfo(current, vodId, baseUrl)
        body = Buffer.from(JSON.stringify(info ?? []))
        break
      }
      case 'get_short_epg':
      case 'get_simple_data_table':
        body = Buffer.from(JSON.stringify({ epg_listings: [] }))
        break
      default:
        body = Buffer.from('[]')
    }

    headers(res, 'application/json')
    record.status = 200
    send(res, body, record)
  }

  function m3u(output: string): string {
    if (!catalog) return ''
    const current = catalog
    const credentials = `${encodeURIComponent(config.username)}/${encodeURIComponent(config.password)}`
    const liveExt = output === 'm3u8' || output === 'hls' ? 'm3u8' : 'ts'
    const names = (list: { category_id: Json; category_name: string }[]) =>
      new Map(list.map((category) => [String(category.category_id), category.category_name]))
    const liveNames = names(current.liveCategories)
    const vodNames = names(current.vodCategories)
    const seriesNames = names(current.seriesCategories)
    const lines = ['#EXTM3U x-tvg-url="' + `${baseUrl}/xmltv.php?username=${credentials.replace('/', '&password=')}` + '"']
    const attr = (value: Json | undefined) => String(value ?? '').replace(/"/g, "'")

    current.live.forEach((item, index) => {
      const group = liveNames.get(current.liveCategoryOf[index] ?? '') ?? ''
      lines.push(`#EXTINF:-1 tvg-id="${attr(item.epg_channel_id)}" tvg-name="${attr(item.name)}" tvg-logo="${attr(item.stream_icon)}" group-title="${attr(group)}",${item.name}`)
      if (index === 0) {
        // As lists write them: between the entry's line and its address.
        lines.push(`#EXTVLCOPT:http-user-agent=${M3U_FIRST_CHANNEL_HEADERS.userAgent}`)
        lines.push(`#EXTVLCOPT:http-referrer=${M3U_FIRST_CHANNEL_HEADERS.referer}`)
      }
      lines.push(`${baseUrl}/live/${credentials}/${item.stream_id}.${liveExt}`)
    })
    current.vod.forEach((item, index) => {
      const group = vodNames.get(current.vodCategoryOf[index] ?? '') ?? ''
      lines.push(`#EXTINF:-1 tvg-id="" tvg-name="${attr(item.name)}" tvg-logo="${attr(item.stream_icon)}" group-title="${attr(group)}",${item.name}`)
      lines.push(`${baseUrl}/movie/${credentials}/${item.stream_id}.${item.container_extension}`)
    })
    current.series.forEach((item, index) => {
      const group = seriesNames.get(current.seriesCategoryOf[index] ?? '') ?? ''
      const episodeId = Number(item.series_id) * 100 + 11
      lines.push(`#EXTINF:-1 tvg-id="" tvg-name="${attr(item.name)} S01 E01" tvg-logo="${attr(item.cover)}" group-title="${attr(group)}",${item.name} S01 E01`)
      lines.push(`${baseUrl}/series/${credentials}/${episodeId}.mp4`)
    })
    return lines.join('\r\n') + '\r\n'
  }

  function xmltv(): string {
    if (!catalog) return ''
    const now = Date.now()
    const hour = 3600_000
    const firstHour = Math.floor(now / hour) * hour - 2 * hour
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="abi-mock">']
    if (catalog.demo) {
      for (const item of catalog.live) {
        out.push(`<channel id="${escapeXml(String(item.epg_channel_id))}"><display-name>${escapeXml(String(item.name))}</display-name></channel>`)
      }
      for (const programme of demoGuide(now)) {
        out.push(`<programme start="${xmltvTime(programme.start)}" stop="${xmltvTime(programme.stop)}" channel="${programme.channel}"><title lang="tr">${escapeXml(programme.title)}</title><desc lang="tr">${escapeXml(programme.desc)}</desc></programme>`)
      }
      out.push('</tv>')
      return out.join('\n')
    }
    const withEpg = catalog.live.filter((item) => typeof item.epg_channel_id === 'string' && item.epg_channel_id)
    for (const item of withEpg) {
      out.push(`<channel id="${escapeXml(String(item.epg_channel_id))}"><display-name>${escapeXml(String(item.name))}</display-name><icon src="${escapeXml(String(item.stream_icon ?? ''))}"/></channel>`)
    }
    withEpg.forEach((item, channelIndex) => {
      for (let slot = 0; slot < 12; slot += 1) {
        const start = firstHour + slot * hour
        const title = `Program ${slot + 1}: ${['Haberler', 'Sabah Kuşağı', 'Belgesel', 'Maç Özeti', 'Dizi', 'Film Kuşağı'][(slot + channelIndex) % 6]}`
        // Every third channel sends titles in two languages (plan item F1-30).
        const titles = channelIndex % 3 === 0
          ? `<title lang="en">Programme ${slot + 1}</title><title lang="tr">${escapeXml(title)}</title>`
          : `<title lang="tr">${escapeXml(title)}</title>`
        out.push(`<programme start="${xmltvTime(start)}" stop="${xmltvTime(start + hour)}" channel="${escapeXml(String(item.epg_channel_id))}">${titles}<desc lang="tr">Açıklama: ${escapeXml(title)} — ölçüm için sahte yayın akışı.</desc></programme>`)
      }
    })
    out.push('</tv>')
    return out.join('\n')
  }

  function streamOpened(res: ServerResponse) {
    activeStreams += 1
    maxConcurrentStreams = Math.max(maxConcurrentStreams, activeStreams)
    res.once('close', () => {
      activeStreams -= 1
    })
  }

  function liveTs(res: ServerResponse, record: RequestRecord, rule: FailureRule | null) {
    const data = file(media.liveTs)
    const bytesPerSec = data.length / media.liveSeconds
    const rate = Math.min(bytesPerSec, config.bandwidthBytesPerSec ?? Infinity)
    headers(res, 'video/mp2t')
    record.status = 200
    res.statusCode = 200
    streamOpened(res)
    const packet = 188
    let offset = 0
    let sent = 0
    const write = (bytes: number) => {
      let remaining = Math.max(packet, Math.floor(bytes / packet) * packet)
      while (remaining > 0 && !res.destroyed) {
        const end = Math.min(data.length, offset + remaining)
        const piece = data.subarray(offset, end)
        res.write(piece)
        sent += piece.length
        remaining -= piece.length
        offset = end >= data.length ? 0 : end
      }
      record.bytes = sent
    }
    write(config.liveBurstSeconds * rate)
    const tickMs = 100
    const pump = () => {
      if (res.destroyed || res.writableEnded) return
      write((rate * tickMs) / 1000)
      later(tickMs, pump)
    }
    later(tickMs, pump)
    if (rule?.mode === 'drop') later(rule.afterMs ?? 3000, () => res.socket?.destroy())
    if (rule?.mode === 'end') later(rule.afterMs ?? 3000, () => res.end())
  }

  function hlsPlaylist(streamId: string, res: ServerResponse, record: RequestRecord) {
    const count = media.hlsSegments.length
    const segment = media.hlsSegmentSeconds
    // Pretend the channel has been on air for a while so the first request already has a full window.
    const elapsed = (Date.now() - startedAt) / 1000 + (HLS_WINDOW + 1) * segment
    const available = Math.floor(elapsed / segment)
    const first = Math.max(0, available - HLS_WINDOW)
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${hlsTarget}`,
      `#EXT-X-MEDIA-SEQUENCE:${first}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${first > 0 ? Math.floor((first - 1) / count) : 0}`
    ]
    for (let n = first; n < available; n += 1) {
      if (n > 0 && n % count === 0) lines.push('#EXT-X-DISCONTINUITY')
      lines.push(`#EXTINF:${itemAt(hlsDurations, n % count).toFixed(3)},`)
      lines.push(`/hls/${encodeURIComponent(streamId)}/${n}.ts`)
    }
    headers(res, 'application/vnd.apple.mpegurl')
    record.status = 200
    send(res, Buffer.from(lines.join('\n') + '\n'), record)
  }

  function staticFile(
    req: IncomingMessage,
    res: ServerResponse,
    record: RequestRecord,
    path: string,
    contentType: string,
    rule: FailureRule | null
  ) {
    const data = file(path)
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    let start = 0
    let end = data.length - 1
    if (range) {
      if (range[1]) start = Number(range[1])
      if (range[2]) end = Math.min(end, Number(range[2]))
      if (!range[1] && range[2]) {
        start = Math.max(0, data.length - Number(range[2]))
        end = data.length - 1
      }
      if (start > end || start >= data.length) {
        res.statusCode = 416
        headers(res, contentType, { 'Content-Range': `bytes */${data.length}` })
        record.status = 416
        res.end()
        return
      }
    }
    const body = data.subarray(start, end + 1)
    res.statusCode = range ? 206 : 200
    record.status = res.statusCode
    headers(res, contentType, {
      'Accept-Ranges': 'bytes',
      'Content-Length': body.length,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {})
    })
    if (STREAM_ROUTES.has(record.route)) streamOpened(res)
    if (rule?.mode === 'drop') later(rule.afterMs ?? 3000, () => res.socket?.destroy())
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    send(res, body, record)
  }

  function mediaForExtension(extension: string): { path: string; type: string } {
    switch (extension.toLowerCase()) {
      case 'mkv':
        return { path: media.multiMkv, type: 'video/x-matroska' }
      case 'ts':
        return { path: media.liveTs, type: 'video/mp2t' }
      case 'avi':
        return { path: media.filmMp4, type: 'video/x-msvideo' }
      default:
        return { path: media.filmMp4, type: 'video/mp4' }
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', baseUrl)
    const path = url.pathname

    if (path.startsWith('/__mock/')) {
      res.setHeader('Content-Type', 'application/json')
      if (path === '/__mock/stats') {
        res.end(JSON.stringify(provider.stats()))
      } else if (path === '/__mock/health') {
        res.end('{"ok":true}')
      } else if (path === '/__mock/config' && req.method === 'POST') {
        let raw = ''
        for await (const piece of req) raw += String(piece)
        provider.update(JSON.parse(raw || '{}') as Partial<MockConfig>)
        res.end(JSON.stringify(config))
      } else if (path === '/__mock/config') {
        res.end(JSON.stringify(config))
      } else {
        res.statusCode = 404
        res.end('{}')
      }
      return
    }

    const record: RequestRecord = { route: 'unknown', status: 0, at: Date.now() - startedAt, bytes: 0 }
    if (typeof req.headers['user-agent'] === 'string') record.userAgent = req.headers['user-agent']
    if (typeof req.headers.referer === 'string') record.referer = req.headers.referer
    recent.push(record)
    if (recent.length > 500) recent = recent.slice(-500)

    if (req.method === 'OPTIONS') {
      record.route = 'preflight'
      counts.preflight = (counts.preflight ?? 0) + 1
      if (config.cors) {
        headers(res, 'text/plain')
        res.statusCode = 204
        record.status = 204
      } else {
        res.statusCode = 405
        record.status = 405
      }
      res.end()
      return
    }

    if (config.latencyMs > 0) await sleep(config.latencyMs)

    const positional = /^\/(live|movie|series)\/([^/]+)\/([^/]+)\/([^/.]+)\.([A-Za-z0-9]+)$/.exec(path)
    const segment = /^\/hls\/([^/]+)\/(\d+)\.ts$/.exec(path)
    const image = /^\/img\/(logo|poster|backdrop)\/(\d+)\.png$/.exec(path)
    const demoImage = /^\/img\/demo\/([a-z0-9-]+\.jpg)$/.exec(path)
    const demoLogo = /^\/img\/demo-logo\/(\d+)\.svg$/.exec(path)

    try {
      if (path === '/player_api.php') {
        playerApi(url.searchParams, res, record)
      } else if (path === '/get.php') {
        record.route = 'm3u'
        const rule = failureFor('m3u')
        if (rule && applyFailure(rule, res, record)) return
        if (!credentialsOk(url.searchParams.get('username'), url.searchParams.get('password'))) {
          res.statusCode = 401
          record.status = 401
          headers(res, 'text/plain')
          res.end('Unauthorized')
          return
        }
        const output = url.searchParams.get('output') ?? 'ts'
        headers(res, 'audio/x-mpegurl; charset=utf-8', { 'Content-Disposition': 'attachment; filename="playlist.m3u"' })
        record.status = 200
        send(res, cached(`m3u:${output}`, () => m3u(output)), record)
      } else if (path === '/xmltv.php') {
        record.route = 'xmltv'
        const rule = failureFor('xmltv')
        if (rule && applyFailure(rule, res, record)) return
        headers(res, 'application/xml; charset=utf-8')
        record.status = 200
        send(res, Buffer.from(xmltv()), record)
      } else if (positional) {
        const [, kind] = positional
        const user = itemAt(positional, 2)
        const pass = itemAt(positional, 3)
        const id = itemAt(positional, 4)
        const extension = itemAt(positional, 5)
        record.route = kind === 'live' ? (extension === 'm3u8' ? 'live-hls' : 'live-ts') : kind === 'movie' ? 'movie' : 'series-episode'
        const rule = failureFor(record.route)
        if (rule && applyFailure(rule, res, record)) return
        if (!credentialsOk(decodeURIComponent(user), decodeURIComponent(pass))) {
          res.statusCode = 403
          record.status = 403
          headers(res, 'text/plain')
          res.end('Forbidden')
          return
        }
        if (record.route === 'live-hls') hlsPlaylist(id, res, record)
        else if (record.route === 'live-ts') liveTs(res, record, rule)
        else {
          const target = mediaForExtension(extension)
          staticFile(req, res, record, target.path, target.type, rule)
        }
      } else if (segment) {
        record.route = 'hls-segment'
        const rule = failureFor('hls-segment')
        if (rule && applyFailure(rule, res, record)) return
        const n = Number(segment[2])
        staticFile(req, res, record, itemAt(media.hlsSegments, n % media.hlsSegments.length), 'video/mp2t', rule)
      } else if (image) {
        record.route = 'img'
        const rule = failureFor('img')
        if (rule && applyFailure(rule, res, record)) return
        const [, kind, id] = image
        const key = `${kind}:${id}`
        let png = artwork.get(key)
        if (!png) {
          png = kind === 'logo' ? artworkPng(Number(id), 64, 64) : kind === 'poster' ? artworkPng(Number(id), 120, 180) : artworkPng(Number(id), 320, 180)
          artwork.set(key, png)
        }
        headers(res, 'image/png')
        record.status = 200
        send(res, png, record)
      } else if (demoImage || demoLogo) {
        record.route = 'img'
        const svg = demoLogo ? demoLogoSvg(Number(demoLogo[1])) : null
        if (demoLogo && !svg) {
          res.statusCode = 404
          record.status = 404
          res.end()
          return
        }
        headers(res, svg ? 'image/svg+xml' : 'image/jpeg')
        record.status = 200
        send(res, svg ? Buffer.from(svg) : file(join(DEMO_ASSETS_DIR, itemAt(demoImage ?? [], 1))), record)
      } else {
        record.route = 'not-found'
        res.statusCode = 404
        record.status = 404
        headers(res, 'text/plain')
        res.end('Not found')
      }
    } finally {
      counts[record.route] = (counts[record.route] ?? 0) + 1
    }
  }

  let certificate: GeneratedCertificate | null =
    options.tls === true ? generateSelfSignedCertificate({ altNames: ['127.0.0.1', 'localhost'] }) : options.tls || null
  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        res.statusCode = 500
        res.end(String(error))
      } else {
        res.destroy()
      }
    })
  }
  const server: Server | HttpsServer = certificate
    ? createHttpsServer({ cert: certificate.cert, key: certificate.key }, onRequest)
    : createServer(onRequest)
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = `${certificate ? 'https' : 'http'}://${options.host ?? '127.0.0.1'}:${address.port}`
  catalog = options.demo ? generateDemoCatalog(baseUrl) : generateCatalog(size, baseUrl, options.seed)

  const provider: MockProvider = {
    url: baseUrl,
    port: address.port,
    get username() {
      return config.username
    },
    get password() {
      return config.password
    },
    catalog,
    config,
    get certificate() {
      return certificate
    },
    setCertificate(next) {
      if (!certificate) throw new Error('setCertificate needs the HTTPS mode')
      certificate = next
      ;(server as HttpsServer).setSecureContext({ cert: next.cert, key: next.key })
      for (const socket of sockets) socket.destroy()
    },
    m3uUrl(output = 'ts') {
      return `${baseUrl}/get.php?username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}&type=m3u_plus&output=${output}`
    },
    update(patch) {
      Object.assign(config, patch)
      if (patch.failures) failureUses.clear()
      if (patch.username !== undefined || patch.password !== undefined) {
        for (const key of [...serialized.keys()]) if (key.startsWith('m3u:')) serialized.delete(key)
      }
    },
    stats() {
      return { counts: { ...counts }, activeStreams, maxConcurrentStreams, recent: recent.map((item) => ({ ...item })) }
    },
    resetStats() {
      counts = {}
      recent = []
      maxConcurrentStreams = activeStreams
    },
    close() {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      for (const socket of sockets) socket.destroy()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
  return provider
}
