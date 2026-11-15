import type { AudioTrack, SubtitleTrack } from '@/types/player'

function normalizeLanguageTag(value: string | undefined): string {
  return value?.trim().toLowerCase() || ''
}

// ISO 639-2 codes (terminological and bibliographic forms) and the English
// names some HLS manifests use, mapped to ISO 639-1. The settings menus store
// two-letter codes while MKV and MPEG-TS tracks report three-letter ones.
const LANGUAGE_ALIASES: Record<string, string> = {
  tur: 'tr', turkish: 'tr', türkçe: 'tr', turkce: 'tr',
  eng: 'en', english: 'en',
  deu: 'de', ger: 'de', german: 'de', deutsch: 'de',
  fra: 'fr', fre: 'fr', french: 'fr', français: 'fr',
  spa: 'es', spanish: 'es', español: 'es',
  ita: 'it', italian: 'it',
  por: 'pt', portuguese: 'pt',
  rus: 'ru', russian: 'ru',
  ara: 'ar', arabic: 'ar',
  nld: 'nl', dut: 'nl', dutch: 'nl',
  ell: 'el', gre: 'el', greek: 'el',
  fas: 'fa', per: 'fa', persian: 'fa',
  aze: 'az', azerbaijani: 'az',
  kur: 'ku', kurdish: 'ku',
  pol: 'pl', polish: 'pl',
  ron: 'ro', rum: 'ro', romanian: 'ro',
  swe: 'sv', swedish: 'sv',
  dan: 'da', danish: 'da',
  nor: 'no', nob: 'no', nno: 'no', norwegian: 'no',
  fin: 'fi', finnish: 'fi',
  hun: 'hu', hungarian: 'hu',
  ces: 'cs', cze: 'cs', czech: 'cs',
  slk: 'sk', slo: 'sk', slovak: 'sk',
  slv: 'sl', slovenian: 'sl',
  bul: 'bg', bulgarian: 'bg',
  srp: 'sr', serbian: 'sr',
  hrv: 'hr', croatian: 'hr',
  bos: 'bs', bosnian: 'bs',
  sqi: 'sq', alb: 'sq', albanian: 'sq',
  mkd: 'mk', mac: 'mk', macedonian: 'mk',
  ukr: 'uk', ukrainian: 'uk',
  heb: 'he', hebrew: 'he',
  hin: 'hi', hindi: 'hi',
  urd: 'ur', urdu: 'ur',
  kat: 'ka', geo: 'ka', georgian: 'ka',
  hye: 'hy', arm: 'hy', armenian: 'hy',
  jpn: 'ja', japanese: 'ja',
  kor: 'ko', korean: 'ko',
  zho: 'zh', chi: 'zh', chinese: 'zh',
  tha: 'th', thai: 'th',
  vie: 'vi', vietnamese: 'vi',
  ind: 'id', indonesian: 'id',
  msa: 'ms', may: 'ms', malay: 'ms',
  isl: 'is', ice: 'is', icelandic: 'is',
  cym: 'cy', wel: 'cy', welsh: 'cy',
  eus: 'eu', baq: 'eu', basque: 'eu',
  cat: 'ca', catalan: 'ca',
  lit: 'lt', lithuanian: 'lt',
  lav: 'lv', latvian: 'lv',
  est: 'et', estonian: 'et',
  // Legacy two-letter codes still found in older files.
  iw: 'he', in: 'id', ji: 'yi'
}

/**
 * Normalize a language tag so different spellings of the same language
 * compare equal: lowercased, '_' read as '-', and the primary subtag mapped
 * to ISO 639-1 where one exists ("tur" and "TUR" become "tr", "ger" and "deu"
 * become "de", "pt_BR" becomes "pt-br"). A region or other subtag is kept.
 * Unknown tags are returned lowercased; empty input returns ''.
 */
export function normalizeLanguageCode(value: string | null | undefined): string {
  const tag = normalizeLanguageTag(value ?? undefined).replace(/_/g, '-')
  if (!tag) return ''
  const dash = tag.indexOf('-')
  const primary = dash === -1 ? tag : tag.slice(0, dash)
  const rest = dash === -1 ? '' : tag.slice(dash)
  return (LANGUAGE_ALIASES[primary] ?? primary) + rest
}

function languageMatches(trackLanguage: string | undefined, preferredLanguage: string): boolean {
  if (normalizeLanguageTag(preferredLanguage) === 'auto') return false
  const track = normalizeLanguageCode(trackLanguage)
  const preferred = normalizeLanguageCode(preferredLanguage)
  if (!track || !preferred) return false

  // Match exact code (tr) and common regional forms (tr-tr / en-us).
  return (
    track === preferred ||
    track.startsWith(`${preferred}-`) ||
    preferred.startsWith(`${track}-`)
  )
}

export function pickPreferredAudioTrackId(
  tracks: AudioTrack[],
  preferredLanguage: string
): string | null {
  const preferredTrack = tracks.find((track) => languageMatches(track.lang, preferredLanguage))
  if (preferredTrack) return preferredTrack.id

  const defaultTrack = tracks.find((track) => track.default)
  if (defaultTrack) return defaultTrack.id

  return tracks[0]?.id ?? null
}

export function pickPreferredSubtitleTrackId(
  tracks: SubtitleTrack[],
  preferredLanguage: string
): string | null {
  const preferredTrack = tracks.find((track) => languageMatches(track.lang, preferredLanguage))
  if (preferredTrack) return String(preferredTrack.id)
  return tracks[0] ? String(tracks[0].id) : null
}

export function collectTrackLanguages(tracks: Array<{ lang?: string }>): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const track of tracks) {
    const normalized = normalizeLanguageTag(track.lang)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}
