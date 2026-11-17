/*
 * Small readers for untrusted add-on JSON: everything an add-on returns is
 * checked field by field, cut to a sane length and dropped when it has the
 * wrong shape. Nothing here throws.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// C0 controls except tab and newline, DEL, C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

/**
 * A string trimmed, without control characters (tabs and line breaks kept
 * when `multiline`, else folded into spaces) and at most `max` characters.
 * Null when it is not a string or nothing is left.
 */
export function readText(value: unknown, max: number, options: { multiline?: boolean } = {}): string | null {
  if (typeof value !== 'string') return null
  let text = value.replace(CONTROL_CHARS, '')
  text = options.multiline ? text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : text.replace(/\s+/g, ' ')
  text = text.trim()
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Like `readText`, for ids: never shortened (a cut id is another id), null when too long. */
export function readId(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  // eslint-disable-next-line no-control-regex
  if (!id || id.length > max || /[\u0000-\u001f\u007f-\u009f]/.test(id)) return null
  return id
}

/** Strings of a list (or one string), each through `readText`, at most `maxItems`. */
export function readTextList(value: unknown, maxItems: number, maxLength: number): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const list: string[] = []
  for (const item of raw) {
    if (list.length >= maxItems) break
    const text = readText(item, maxLength)
    if (text && !list.includes(text)) list.push(text)
  }
  return list
}

/** An array cut to `max` entries; anything else is an empty list. */
export function readArray(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : []
}

/** Longest URL accepted for an image or a stream. */
export const MAX_URL_LENGTH = 8192

/** An absolute http(s) URL without credentials in it, normalised; null for anything else. */
export function readHttpUrl(value: unknown, max = MAX_URL_LENGTH): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > max || /\s/.test(text)) return null
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url.href.length > max ? null : url.href
  } catch {
    return null
  }
}

/** A finite, non-negative integer (or a numeric string of one); null otherwise. */
export function readCount(value: unknown): number | null {
  const number = typeof value === 'string' && /^\s*\d{1,9}\s*$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 ? number : null
}

/** A finite, non-negative number; null otherwise. */
export function readSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
