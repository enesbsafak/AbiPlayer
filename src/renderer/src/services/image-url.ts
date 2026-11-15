/**
 * Make a provider image URL loadable without changing one that already works.
 *
 * Provider artwork arrives protocol-relative ("//img..."), with backslashes,
 * with raw spaces or Turkish letters, or already percent-encoded. Running
 * `encodeURI` over everything turned "%20" into "%2520" and broke the
 * already-encoded posters, so only what needs repair is touched: an absolute
 * URL that parses is used in its parsed form (the URL parser percent-encodes
 * spaces and non-ASCII characters and leaves existing escapes alone), and
 * only text that does not parse at all goes through `encodeURI`.
 */
export function normalizeImageSrc(src?: string | null): string | undefined {
  const trimmed = typeof src === 'string' ? src.trim() : ''
  if (!trimmed) return undefined

  const withProtocol = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed
  const fixedSlashes = withProtocol.replace(/\\/g, '/')

  try {
    return new URL(fixedSlashes).href
  } catch {
    // Not an absolute URL (relative path, data fragment, garbage).
  }

  try {
    return encodeURI(fixedSlashes)
  } catch {
    // encodeURI throws on lone surrogates; keep the text as it is.
    return fixedSlashes
  }
}
