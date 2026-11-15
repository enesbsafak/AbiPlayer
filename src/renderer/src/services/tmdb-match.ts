/**
 * Turning provider catalog names into TMDB searches, and deciding whether a
 * search result is really the same title. Pure functions, no network.
 *
 * Provider names look like "TR: Film Adı (2019) 4K", "[EN] Film.Adı.2019.1080p"
 * or "VIP | Film - TR Dublaj". Searching TMDB with that text rarely finds an
 * exact match, and taking the first result instead overwrote the provider's
 * plot and artwork with an unrelated title.
 */

export interface CleanedTitle {
  /** The title with provider prefixes, years and quality tags removed. */
  title: string
  /** A release year found in the name, '' when none. */
  year: string
}

// Provider language/country prefixes written with a dash ("TR - Film"). With a
// colon or a pipe any short code counts ("4K: Film", "VIP | Film"), but a dash
// alone is too common inside real titles to accept arbitrary codes.
const DASH_PREFIX_CODES = new Set([
  'TR', 'EN', 'US', 'UK', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'RU', 'AR', 'PL', 'PT', 'BR',
  'SE', 'NO', 'DK', 'FI', 'GR', 'AZ', 'KU', 'IR', 'IN', 'JP', 'KR', 'CN', 'MULTI'
])

// Whole-word tags that describe the file, not the title. \b is ASCII-only,
// so letter/digit lookarounds bound the words; with \b "dublajlı" and
// "altyazı" never matched.
const QUALITY_TAG_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:` +
    [
      String.raw`\d{3,4}p`, '4k', '8k', 'uhd', 'fhd', 'hd', 'sd', 'hq', 'hdr10\\+?', 'hdr', 'dv', 'sdr',
      'x26[45]', 'h\\.?26[45]', 'hevc', 'avc', 'aac', 'ac3', 'dts', 'atmos', '10bit',
      'blu-?ray', 'bdrip', 'brrip', 'web-?dl', 'web-?rip', 'webrip', 'hdrip', 'dvdrip', 'dvdscr',
      'hdtv', 'hdcam', 'camrip', 'remux', 'proper', 'repack', 'extended', 'unrated', 'imax',
      'multi', 'dual', 'tr\\s+dublaj', 'türkçe\\s+dublaj', 'turkce\\s+dublaj', 'dublaj', 'dublajlı', 'dublajli',
      'tr\\s+altyazı', 'tr\\s+altyazi', 'altyazılı', 'altyazili', 'altyazı', 'altyazi', 'subbed', 'dubbed'
    ].join('|') +
    String.raw`)(?![\p{L}\p{N}])`,
  'giu'
)

const YEAR_PATTERN = /^(?:19|20)\d{2}$/

function stripProviderPrefixes(input: string): string {
  let text = input.trim()
  // Repeat: "[TR] VIP: Film" carries two prefixes.
  for (let i = 0; i < 3; i += 1) {
    const before = text
    // Bracketed or pipe-wrapped prefix: "[TR] ", "|TR| ", "(TR) ".
    text = text.replace(/^\s*[[|(][^\])|]{1,12}[\])|]\s*/u, '')
    // Upper-case short code with a colon or pipe: "TR: ", "4K-TR | ", "VIP: ".
    // Case-sensitive and without spaces, so "Star Wars: Yeni Umut" survives.
    text = text.replace(/^\s*[A-Z0-9]{2,4}(?:-[A-Z0-9]{2,4})?\s*[:|]\s*/u, '')
    // Known language code with a dash: "TR - ", "EN- ".
    const dash = /^\s*([A-Za-z]{2,5})\s*[-–]\s+/u.exec(text)
    if (dash && DASH_PREFIX_CODES.has(dash[1].toUpperCase())) text = text.slice(dash[0].length)
    if (text === before) break
  }
  return text
}

/**
 * Clean a provider name for a TMDB search: drop provider prefixes, bracketed
 * tags, quality and dubbing tags, and pull out a release year written in
 * parentheses or brackets ("Film (2019)") or in a dotted scene name
 * ("Film.Adi.2019.1080p"). A bare year inside a spaced title is left alone,
 * because it is often part of the title ("Blade Runner 2049", "1917").
 */
export function cleanTitleForTmdbSearch(name: string | null | undefined): CleanedTitle {
  if (!name || typeof name !== 'string') return { title: '', year: '' }

  let text = stripProviderPrefixes(name)
  let year = ''

  // Scene-style names use dots or underscores instead of spaces.
  const looksDotted = !/\s/.test(text) && /[._].*[._]/.test(text)
  if (looksDotted) {
    text = text.replace(/[._]+/g, ' ')
    const dottedYear = /(?:^|\s)((?:19|20)\d{2})(?=\s|$)/.exec(text)
    if (dottedYear && dottedYear.index > 0) {
      year = dottedYear[1]
      text = text.slice(0, dottedYear.index)
    }
  }

  // Parenthesized or bracketed groups: a year is remembered, every group is
  // removed (they hold tags like "[TR Dublaj]" or "(4K)").
  text = text.replace(/[([{]([^)\]}]*)[)\]}]/g, (_match, inner: string) => {
    const trimmed = inner.trim()
    if (!year && YEAR_PATTERN.test(trimmed)) year = trimmed
    return ' '
  })

  text = text.replace(QUALITY_TAG_PATTERN, ' ')
  // Separators left dangling at either end ("Film - ", " | Film").
  text = text.replace(/\s+/g, ' ').replace(/^[\s\-–|:.,]+|[\s\-–|:.,]+$/g, '')

  return { title: text, year }
}

/**
 * Comparison form of a title: lowercased with Turkish rules, diacritics and
 * punctuation removed, "&" read as "and". "Amélie" and "Amelie", "Çağ" and
 * "Cag", "Spider-Man" and "Spider Man" compare equal.
 */
export function normalizeTitleForMatch(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return ''
  return value
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export interface TmdbMatchCandidate {
  id: number
  /** Localized title (movie `title`, TV `name`). */
  title?: string
  /** Original-language title (movie `original_title`, TV `original_name`). */
  originalTitle?: string
  /** Release or first-air date, "YYYY-MM-DD". */
  date?: string
}

function yearOf(date: string | undefined): number | null {
  const match = date ? /(\d{4})/.exec(date) : null
  return match ? Number.parseInt(match[1], 10) : null
}

/**
 * The search result that is confidently the same title, or null. A result
 * must match the cleaned name exactly (localized or original title, after
 * normalization). When a year is known, a result whose year differs by more
 * than one is rejected (release dates vary by country); among the rest the
 * closest year wins. Without a year the first exact match is taken.
 */
export function pickConfidentTmdbMatch(
  candidates: readonly TmdbMatchCandidate[],
  name: string,
  year?: string | number | null
): TmdbMatchCandidate | null {
  const target = normalizeTitleForMatch(name)
  if (!target) return null
  const targetYear = yearOf(year === null || year === undefined ? undefined : String(year))

  const exact = candidates.filter(
    (candidate) =>
      normalizeTitleForMatch(candidate.title) === target ||
      normalizeTitleForMatch(candidate.originalTitle) === target
  )
  if (exact.length === 0) return null
  if (targetYear === null) return exact[0]

  let best: TmdbMatchCandidate | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of exact) {
    const candidateYear = yearOf(candidate.date)
    if (candidateYear === null) continue
    const distance = Math.abs(candidateYear - targetYear)
    if (distance <= 1 && distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}
