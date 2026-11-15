import { XMLParser } from 'fast-xml-parser'
import type { EPGData, EPGProgram, EPGChannel } from '@/types/epg'
import { normalizeLanguageCode } from './track-preferences'

function parseXMLTVDate(str: string): number {
  if (!str) return 0
  const cleaned = str.replace(/\s+/g, '')
  const year = parseInt(cleaned.substring(0, 4))
  const month = parseInt(cleaned.substring(4, 6)) - 1
  const day = parseInt(cleaned.substring(6, 8))
  const hour = parseInt(cleaned.substring(8, 10))
  const minute = parseInt(cleaned.substring(10, 12))
  const second = parseInt(cleaned.substring(12, 14)) || 0

  const tzMatch = cleaned.match(/([+-]\d{4})$/)
  let offsetMs = 0
  if (tzMatch) {
    const tzStr = tzMatch[1]
    const tzHours = parseInt(tzStr.substring(0, 3))
    const tzMinutes = parseInt(tzStr[0] + tzStr.substring(3))
    offsetMs = (tzHours * 60 + tzMinutes) * 60 * 1000
  }

  const utc = Date.UTC(year, month, day, hour, minute, second)
  return utc - offsetMs
}

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

// Only keep programs within a time window to save memory
const EPG_WINDOW_HOURS_BEFORE = 2
const EPG_WINDOW_HOURS_AFTER = 24
const MAX_CHANNELS = 2000
const MAX_PROGRAMS_PER_CHANNEL = 100
const MAX_EPG_SIZE_BYTES = 50 * 1024 * 1024

async function readChunksWithLimit(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxSizeBytes: number
): Promise<{ chunks: Uint8Array[]; truncated: boolean }> {
  const chunks: Uint8Array[] = []
  let truncated = false

  async function readNext(totalSize: number): Promise<void> {
    const { done, value } = await reader.read()
    if (done) return

    const nextSize = totalSize + value.length
    if (nextSize > maxSizeBytes) {
      // Keep the bytes up to the limit; the XML is repaired at the last
      // complete element before parsing.
      chunks.push(value.subarray(0, maxSizeBytes - totalSize))
      truncated = true
      await reader.cancel()
      return
    }

    chunks.push(value)
    await readNext(nextSize)
  }

  await readNext(0)
  return { chunks, truncated }
}

/**
 * Close a document that was cut off mid-stream: drop everything after the
 * last complete <programme> (or <channel>, if no programme finished) and
 * close the root, so the parser sees only whole elements.
 */
export function closeTruncatedXmltv(xml: string): string {
  const endOf = (tag: string): number => {
    const index = xml.lastIndexOf(tag)
    return index === -1 ? -1 : index + tag.length
  }
  let cut = endOf('</programme>')
  if (cut === -1) cut = endOf('</channel>')
  if (cut === -1) return '<tv></tv>'
  return `${xml.slice(0, cut)}\n</tv>`
}

export async function fetchAndParseEPG(url: string, options?: { signal?: AbortSignal }): Promise<EPGData> {
  const controller = new AbortController()
  // 60 second timeout for large EPG files
  const timeout = setTimeout(() => controller.abort(), 60000)
  const signal = options?.signal
  const abortFromSignal = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abortFromSignal, { once: true })
  }

  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`EPG indirilemedi: ${res.status}`)

    // Read as text - for very large files, limit to ~50MB
    const reader = res.body?.getReader()
    if (!reader) throw new Error('Sunucudan geçerli veri gelmedi')

    const { chunks, truncated } = await readChunksWithLimit(reader, MAX_EPG_SIZE_BYTES)

    const decoder = new TextDecoder()
    const parts: string[] = []
    for (const chunk of chunks) {
      parts.push(decoder.decode(chunk, { stream: true }))
    }
    parts.push(decoder.decode())

    // Free chunks
    chunks.length = 0
    const xml = parts.join('')
    parts.length = 0

    if (!truncated) return parseEPGXml(xml)
    return { ...parseEPGXml(closeTruncatedXmltv(xml)), truncated: true }
  } finally {
    clearTimeout(timeout)
    if (signal) signal.removeEventListener('abort', abortFromSignal)
  }
}

// Keys from untrusted XML are used as property names. Without protection, a channel
// id like "__proto__" or "constructor" can pollute Object prototype and cause subtle
// runtime bugs or unsafe downstream lookups. We reject these unsafe keys outright.
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const XML_NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&'
}

/**
 * fast-xml-parser runs with `processEntities: false` so a hostile XMLTV feed
 * can't blow us up with a custom DOCTYPE entity expansion. That also leaves the
 * five predefined entities and numeric references raw, so titles arrive as
 * "Tom &amp; Jerry" — decode just those, without touching DTD-defined names.
 */
export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) return value

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }

    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }

    return XML_NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

function decodeXmlText(value: unknown): string | undefined {
  if (typeof value === 'string') return decodeXmlEntities(value)
  if (typeof value === 'number') return String(value)
  return undefined
}

export interface LocalizedText {
  text: string
  /** The element's `lang` attribute as written, '' when absent. */
  lang: string
}

/** Languages tried in order before falling back to the first text. */
const PREFERRED_EPG_LANGUAGES: readonly string[] = ['tr']

function collectLocalizedTexts(value: unknown): LocalizedText[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return items.flatMap((item: unknown) => {
    let raw: unknown = item
    let lang = ''
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>
      raw = record['#text']
      if (typeof record['@_lang'] === 'string') lang = record['@_lang']
    }
    const text = decodeXmlText(raw)?.trim()
    return text ? [{ text, lang }] : []
  })
}

/**
 * XMLTV repeats <title>, <desc>, <category> and <display-name> once per
 * language (`<title lang="tr">…</title><title lang="en">…</title>`), which the
 * parser hands over as an array. Pick the preferred language — Turkish first,
 * matching "tr", "tur" or "tr-TR" alike — and otherwise the first non-empty
 * text.
 */
export function pickLocalizedText(
  value: unknown,
  preferredLanguages: readonly string[] = PREFERRED_EPG_LANGUAGES
): LocalizedText | undefined {
  const texts = collectLocalizedTexts(value)
  for (const preferred of preferredLanguages) {
    const wanted = normalizeLanguageCode(preferred)
    if (!wanted) continue
    const match = texts.find((entry) => {
      const lang = normalizeLanguageCode(entry.lang)
      return lang === wanted || lang.startsWith(`${wanted}-`)
    })
    if (match) return match
  }
  return texts[0]
}

export function normalizeEpgChannelKey(id: string | null | undefined): string | null {
  if (!id) return null
  // EPG IDs are technical identifiers (e.g. "istanbul.tr", "TRT1.tr") — compare
  // them ASCII-case-insensitively. Turkish-locale lowercasing would map 'I' to
  // 'ı', which desyncs ids like "Istanbul.tr" (from XML) vs "istanbul.tr"
  // (from a channel) that callers expect to match.
  const key = id.toLowerCase()
  if (!key || UNSAFE_KEYS.has(key)) return null
  return key
}

function normalizeChannelKey(id: string): string | null {
  return normalizeEpgChannelKey(id)
}

export function parseEPGXml(xml: string): EPGData {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['channel', 'programme', 'display-name'].includes(name),
    // Keep text as written: number parsing turned a title like "007" into 7.
    parseTagValue: false,
    processEntities: false
  })

  const parsed = parser.parse(xml)
  const tv = parsed.tv || parsed.TV || {}

  // Use null-prototype objects so malicious channel ids cannot reach Object.prototype.
  const channels = Object.create(null) as Record<string, EPGChannel>
  const programs = Object.create(null) as Record<string, EPGProgram[]>

  // Time window for filtering
  const now = Date.now()
  const windowStart = now - EPG_WINDOW_HOURS_BEFORE * 3600000
  const windowEnd = now + EPG_WINDOW_HOURS_AFTER * 3600000

  // Parse channels (limited) — store with lowercase key for case-insensitive matching
  const xmlChannels = ensureArray(tv.channel).slice(0, MAX_CHANNELS)
  for (const ch of xmlChannels) {
    const id = typeof ch['@_id'] === 'string' ? ch['@_id'] : ''
    if (!id) continue
    const key = normalizeChannelKey(id)
    if (!key) continue
    channels[key] = {
      id,
      displayName: pickLocalizedText(ch['display-name'])?.text || id,
      icon: ch.icon?.['@_src']
    }
  }

  // Parse programmes - only within time window, lowercase channel keys
  const xmlProgs = ensureArray(tv.programme)
  for (const prog of xmlProgs) {
    const rawChannelId = typeof prog['@_channel'] === 'string' ? prog['@_channel'] : ''
    if (!rawChannelId) continue
    const channelId = normalizeChannelKey(rawChannelId)
    if (!channelId) continue

    const start = parseXMLTVDate(prog['@_start'] || '')
    const end = parseXMLTVDate(prog['@_stop'] || '')

    // Skip programs outside our window
    if (end < windowStart || start > windowEnd) continue

    if (!programs[channelId]) programs[channelId] = []

    // Limit per channel
    if (programs[channelId].length >= MAX_PROGRAMS_PER_CHANNEL) continue

    const title = pickLocalizedText(prog.title)
    const desc = pickLocalizedText(prog.desc)
    const category = pickLocalizedText(prog.category)

    programs[channelId].push({
      channelId,
      title: title?.text || 'Başlık Yok',
      description: desc?.text || undefined,
      start,
      end,
      category: category?.text || undefined,
      icon: prog.icon?.['@_src'],
      lang: title?.lang || undefined
    })
  }

  // Sort programs by start time
  for (const channelId of Object.keys(programs)) {
    programs[channelId].sort((a, b) => a.start - b.start)
  }

  return { channels, programs, lastUpdated: Date.now() }
}

export function findCurrentProgram(programs: EPGProgram[], now?: number): EPGProgram | null {
  const timestamp = now ?? Date.now()
  if (!programs || programs.length === 0) return null

  let low = 0
  let high = programs.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const prog = programs[mid]
    if (timestamp >= prog.start && timestamp < prog.end) return prog
    if (timestamp < prog.start) high = mid - 1
    else low = mid + 1
  }

  return null
}

export function getUpcomingPrograms(programs: EPGProgram[], count = 5, now?: number): EPGProgram[] {
  const timestamp = now ?? Date.now()
  if (!programs) return []
  const idx = programs.findIndex((p) => p.end > timestamp)
  if (idx === -1) return []
  return programs.slice(idx, idx + count)
}
