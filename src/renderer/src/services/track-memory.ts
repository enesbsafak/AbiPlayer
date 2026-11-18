import { mediaKey, type PlaybackTarget } from '../../../shared/playback'
import { normalizeLanguageCode } from './track-preferences'

/*
 * What the viewer last chose for a series (or a film, a channel): the
 * subtitle, or "off", and the audio track. The next episode opens with the
 * same choice instead of the settings' default, and so does the same item
 * after a restart. A track is remembered by its language and name, never by
 * its number: the next episode may order its tracks differently.
 */

export interface RememberedTrack {
  lang?: string
  /** The name the track menu showed (its title, its language, or "Altyazı 2"). */
  name: string
}

export interface RememberedTracks {
  subtitle?: RememberedTrack | 'off'
  audio?: RememberedTrack
}

export interface TrackMemoryEntry extends RememberedTracks {
  key: string
  updatedAt: number
}

export const MAX_TRACK_MEMORY = 200
const MAX_TEXT_LENGTH = 200

/** Episodes share their series' memory; everything else has its own. */
export function trackMemoryKey(target: PlaybackTarget): string {
  if (target.kind === 'episode' && target.seriesId !== null) {
    return mediaKey({ kind: 'series', sourceId: target.sourceId, seriesId: target.seriesId })
  }
  return mediaKey(target)
}

export function findTrackMemory(entries: readonly TrackMemoryEntry[], target: PlaybackTarget): RememberedTracks | null {
  const key = trackMemoryKey(target)
  const entry = entries.find((candidate) => candidate.key === key)
  if (!entry) return null
  return {
    ...(entry.subtitle !== undefined ? { subtitle: entry.subtitle } : {}),
    ...(entry.audio !== undefined ? { audio: entry.audio } : {})
  }
}

/** The list with `choice` recorded for the target: newest first, the oldest dropped past the limit. */
export function rememberTracks(
  entries: readonly TrackMemoryEntry[],
  target: PlaybackTarget,
  choice: RememberedTracks,
  now = Date.now()
): TrackMemoryEntry[] {
  const key = trackMemoryKey(target)
  const previous = entries.find((entry) => entry.key === key)
  const next: TrackMemoryEntry = { ...previous, ...choice, key, updatedAt: now }
  return [next, ...entries.filter((entry) => entry.key !== key)].slice(0, MAX_TRACK_MEMORY)
}

interface NamedTrack {
  id: string | number
  name: string
  lang?: string
}

/** A track of the menu as it is remembered. */
export function rememberedTrackOf(track: NamedTrack): RememberedTrack {
  return { name: track.name, ...(track.lang ? { lang: track.lang } : {}) }
}

/**
 * The track of this list that is the remembered one: same language (and the
 * same name when several share it); a track without a language by its name.
 * Null when the list has no such track.
 */
export function matchRememberedTrack(tracks: readonly NamedTrack[], remembered: RememberedTrack): string | null {
  const language = normalizeLanguageCode(remembered.lang)
  if (language) {
    const sameLanguage = tracks.filter((track) => normalizeLanguageCode(track.lang) === language)
    const match = sameLanguage.find((track) => track.name === remembered.name) ?? sameLanguage[0]
    return match ? String(match.id) : null
  }
  const match = tracks.find((track) => !normalizeLanguageCode(track.lang) && track.name === remembered.name)
  return match ? String(match.id) : null
}

function sanitizeRememberedTrack(raw: unknown): RememberedTrack | null {
  if (!raw || typeof raw !== 'object') return null
  const { name, lang } = raw as Record<string, unknown>
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_TEXT_LENGTH) return null
  return { name, ...(typeof lang === 'string' && lang.length > 0 && lang.length <= MAX_TEXT_LENGTH ? { lang } : {}) }
}

/** The stored list read back (unknown data): anything unreadable is dropped. */
export function sanitizeTrackMemory(raw: unknown): TrackMemoryEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: TrackMemoryEntry[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (entries.length >= MAX_TRACK_MEMORY) break
    if (!item || typeof item !== 'object') continue
    const { key, subtitle, audio, updatedAt } = item as Record<string, unknown>
    if (typeof key !== 'string' || key.length === 0 || key.length > 1024 || seen.has(key)) continue
    const rememberedSubtitle = subtitle === 'off' ? 'off' : sanitizeRememberedTrack(subtitle)
    const rememberedAudio = sanitizeRememberedTrack(audio)
    if (!rememberedSubtitle && !rememberedAudio) continue
    seen.add(key)
    entries.push({
      key,
      ...(rememberedSubtitle ? { subtitle: rememberedSubtitle } : {}),
      ...(rememberedAudio ? { audio: rememberedAudio } : {}),
      updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0
    })
  }
  return entries
}
