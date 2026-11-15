import { normalizeSearchText } from '@/services/text-normalize'

// Printable ASCII and tab only.
const ASCII_ONLY = /^[\t\x20-\x7e]*$/

/**
 * `normalizeSearchText`, with a fast path for plain ASCII names. For ASCII the
 * Turkish lowercasing plus i-folding equals a plain `toLowerCase()` ("I" goes
 * to "ı" and back to "i"), and skipping the locale call matters when 200,000
 * names are normalized in one ingest.
 */
export function normalizeSearchKey(input: string | null | undefined): string {
  if (typeof input !== 'string') return ''
  if (ASCII_ONLY.test(input)) return input.toLowerCase()
  return normalizeSearchText(input)
}
