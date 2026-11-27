/**
 * Request headers a playlist asks for with one of its entries. Some servers
 * only answer a known player's user agent or a request that names the page it
 * came from; an M3U list says so per entry (`#EXTVLCOPT:http-user-agent=...`
 * and the like). Only these three are taken: they are what such lists use,
 * and none of them can carry a second header along.
 *
 * The values come from a file the user loaded and end up in a request, so
 * they are checked where they are read (the playlist parser) and again where
 * they are used (main, before mpv gets them).
 */
export interface StreamHttpHeaders {
  userAgent?: string
  referer?: string
  origin?: string
}

const MAX_USER_AGENT_LENGTH = 512
const MAX_URL_HEADER_LENGTH = 2048

/** Printable ASCII only: no control characters, so no line break can start another header. */
function headerValue(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value.length === 0 || value.length > maxLength) return null
  return /^[\x20-\x7e]+$/.test(value) ? value : null
}

/**
 * The headers of `raw` that are usable, or null when there is none. A referer
 * must be an http(s) address; an origin a bare scheme and host (mpv takes it
 * in a comma-separated list, so a comma is refused there).
 */
export function sanitizeStreamHttpHeaders(raw: unknown): StreamHttpHeaders | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const headers: StreamHttpHeaders = {}

  const userAgent = headerValue(input.userAgent, MAX_USER_AGENT_LENGTH)
  if (userAgent) headers.userAgent = userAgent

  const referer = headerValue(input.referer, MAX_URL_HEADER_LENGTH)
  if (referer && /^https?:\/\/\S+$/i.test(referer)) headers.referer = referer

  const origin = headerValue(input.origin, MAX_URL_HEADER_LENGTH)
  if (origin && /^https?:\/\/[^\s,/]+$/i.test(origin)) headers.origin = origin

  return Object.keys(headers).length > 0 ? headers : null
}

/** The per-file mpv options that send `headers` with one load. */
export function mpvHeaderOptions(headers: StreamHttpHeaders | null | undefined): Record<string, string> {
  const safe = sanitizeStreamHttpHeaders(headers)
  if (!safe) return {}
  const options: Record<string, string> = {}
  if (safe.userAgent) options['user-agent'] = safe.userAgent
  if (safe.referer) options['referrer'] = safe.referer
  if (safe.origin) options['http-header-fields'] = `Origin: ${safe.origin}`
  return options
}
