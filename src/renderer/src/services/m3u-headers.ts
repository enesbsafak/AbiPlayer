import { sanitizeStreamHttpHeaders, type StreamHttpHeaders } from '../../../shared/playback'

/*
 * The ways an M3U list names request headers for an entry:
 *
 *   #EXTINF:-1 http-user-agent="..." http-referrer="...",Name
 *   #EXTVLCOPT:http-user-agent=...        (also http-referrer, http-origin)
 *   #EXTHTTP:{"User-Agent":"...","Referer":"..."}
 *   #KODIPROP:inputstream.adaptive.stream_headers=User-Agent=...&Referer=...
 *   http://host/stream.m3u8|User-Agent=...&Referer=...
 *
 * Everything read here is unchecked text; `finishHeaders` keeps what is safe.
 */

/** Headers collected for the entry being read; unchecked until `finishHeaders`. */
export type PendingHeaders = Record<'userAgent' | 'referer' | 'origin', string | undefined>

export function emptyPendingHeaders(): PendingHeaders {
  return { userAgent: undefined, referer: undefined, origin: undefined }
}

const HEADER_NAMES: Record<string, keyof PendingHeaders> = {
  'user-agent': 'userAgent',
  'http-user-agent': 'userAgent',
  useragent: 'userAgent',
  referer: 'referer',
  referrer: 'referer',
  'http-referer': 'referer',
  'http-referrer': 'referer',
  origin: 'origin',
  'http-origin': 'origin'
}

function setHeader(pending: PendingHeaders, name: string, value: string): void {
  const key = HEADER_NAMES[name.trim().toLowerCase()]
  const text = value.trim()
  if (key && text) pending[key] = text
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** `Name=value&Name=value`, the values percent-encoded or plain. */
function readPairs(text: string, pending: PendingHeaders): void {
  for (const pair of text.split('&')) {
    const equals = pair.indexOf('=')
    if (equals > 0) setHeader(pending, pair.slice(0, equals), decoded(pair.slice(equals + 1)))
  }
}

const EXTINF_HEADER_ATTRIBUTES: Array<[keyof PendingHeaders, RegExp]> = [
  ['userAgent', /(?:http-)?user-agent="([^"]*)"/i],
  ['referer', /(?:http-)?referr?er="([^"]*)"/i]
]

/** Header attributes of an `#EXTINF` line. Most lines have none: checked cheaply first. */
export function readExtInfHeaders(line: string, pending: PendingHeaders): void {
  if (!line.includes('user-agent=') && !line.includes('referer=') && !line.includes('referrer=')) return
  for (const [key, pattern] of EXTINF_HEADER_ATTRIBUTES) {
    const match = pattern.exec(line)
    if (match?.[1]) pending[key] = match[1].trim()
  }
}

/**
 * A `#` line between `#EXTINF` and the entry's URL that names headers.
 * Returns whether the line was one of those directives.
 */
export function readHeaderDirective(line: string, pending: PendingHeaders): boolean {
  if (line.startsWith('#EXTVLCOPT:')) {
    const option = line.slice('#EXTVLCOPT:'.length)
    const equals = option.indexOf('=')
    if (equals > 0) setHeader(pending, option.slice(0, equals), option.slice(equals + 1))
    return true
  }
  if (line.startsWith('#EXTHTTP:')) {
    try {
      const fields: unknown = JSON.parse(line.slice('#EXTHTTP:'.length))
      if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        for (const [name, value] of Object.entries(fields)) {
          if (typeof value === 'string') setHeader(pending, name, value)
        }
      }
    } catch {
      // Not JSON: nothing to read.
    }
    return true
  }
  if (line.startsWith('#KODIPROP:')) {
    const property = line.slice('#KODIPROP:'.length)
    const equals = property.indexOf('=')
    if (equals > 0 && /stream_headers$|manifest_headers$/i.test(property.slice(0, equals).trim())) {
      readPairs(property.slice(equals + 1), pending)
    }
    return true
  }
  return false
}

/**
 * An entry line `url|Name=value&...` split into its address and the headers
 * after the bar. A bar that is not followed by a header name stays part of
 * the address.
 */
export function splitUrlHeaders(line: string, pending: PendingHeaders): string {
  const bar = line.indexOf('|')
  if (bar <= 0) return line
  const suffix = line.slice(bar + 1)
  if (!/^[A-Za-z][A-Za-z-]*=/.test(suffix)) return line
  readPairs(suffix, pending)
  return line.slice(0, bar).trim()
}

/** What is safe to send of the headers collected for one entry, or undefined. */
export function finishHeaders(pending: PendingHeaders): StreamHttpHeaders | undefined {
  if (pending.userAgent === undefined && pending.referer === undefined && pending.origin === undefined) return undefined
  return sanitizeStreamHttpHeaders(pending) ?? undefined
}
