/**
 * Normalize a user-visible string for Turkish-market search/filter comparisons.
 *
 * Turkish locale lowercasing maps ASCII 'I' to dotless 'ı'. That is correct
 * linguistically but breaks casual matching: a channel listed as "izle" won't
 * match a user typing "IZLE", because "IZLE".toLocaleLowerCase('tr') is "ızle".
 *
 * We fold both dotted and dotless i forms to plain ASCII 'i' so the two
 * spellings compare equal, while still handling the Turkish-specific
 * "İ → i" mapping that plain `.toLowerCase()` gets wrong.
 */
export function normalizeSearchText(input: string): string {
  return input
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    // "İ" lowercased in tr locale becomes "i" + combining dot (U+0307) in some
    // environments; strip the combining dot so "İZLE" and "izle" match.
    .replace(/̇/g, '')
}
