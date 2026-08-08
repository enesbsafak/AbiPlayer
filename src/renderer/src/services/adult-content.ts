import type { Category } from '@/types/playlist'

/**
 * Fold a label to plain ASCII lowercase for pattern matching.
 *
 * `normalizeSearchText` only folds the two i forms because that is all casual
 * search needs. Detection here has to survive providers that write the same
 * category as "Yetişkin", "YETISKIN" or "Yetiskın", so every Turkish diacritic
 * is stripped as well — otherwise "yetişkin" and "yetiskin" need two patterns
 * each and one of them always gets forgotten.
 */
function foldForMatching(input: string): string {
  return input
    .toLocaleLowerCase('tr')
    // 'ı' has no decomposed form, so NFD below cannot reach it.
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Word-bounded on purpose: an unbounded /sex/ marks "Sussex" and "Middlesex"
// as adult, and an unbounded /hot/ marks every "Hotel" and "Hotbird" feed.
const ADULT_PATTERNS: RegExp[] = [
  /\bxxx+\b/,
  /\b18\s*\+/,
  /\+\s*18\b/,
  /\b18\s*yas\b/,
  /\badults?\b/,
  // Covers erotik / erotic / erotica / erotique in one pattern.
  /\berot[a-z]*\b/,
  // porn / porno / pornhub.
  /\bporn[a-z]*\b/,
  // sex / sexy / sexo.
  /\bsex[a-z]*\b/,
  /\byetiskin\b/,
  // Unambiguous adult brands that show up as bare category names.
  /\bbrazzers\b/,
  /\bplayboy\b/,
  /\bhustler\b/,
  /\bpenthouse\b/,
  /\bdorcel\b/,
  /\bredlight\b/
]

/** True when a channel, group or category label reads as adult content. */
export function isAdultLabel(text: string | null | undefined): boolean {
  if (!text) return false
  const folded = foldForMatching(text)
  return ADULT_PATTERNS.some((pattern) => pattern.test(folded))
}

/**
 * IDs of every category whose name reads as adult content.
 *
 * Channels need this because their own name is often clean ("Kanal 1") while
 * the category they sit in is not, and Xtream channels don't even carry a
 * category name — only an id. Resolving it once per category list keeps the
 * per-channel check a single Set lookup instead of a regex sweep.
 */
export function collectAdultCategoryIds(categories: Category[]): Set<string> {
  const ids = new Set<string>()
  for (const category of categories) {
    if (isAdultLabel(category.name)) ids.add(category.id)
  }
  return ids
}
