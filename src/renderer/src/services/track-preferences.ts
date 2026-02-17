import type { AudioTrack, SubtitleTrack } from '@/types/player'

function normalizeLanguageTag(value: string | undefined): string {
  return value?.trim().toLowerCase() || ''
}

function languageMatches(trackLanguage: string | undefined, preferredLanguage: string): boolean {
  const track = normalizeLanguageTag(trackLanguage)
  const preferred = normalizeLanguageTag(preferredLanguage)
  if (!track || !preferred || preferred === 'auto') return false

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
