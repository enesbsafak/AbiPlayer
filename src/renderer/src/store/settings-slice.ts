import type { StateCreator } from 'zustand'
import type { UserSettings } from '@/types/settings'
import { DEFAULT_SEEK_STEP_SECONDS, DEFAULT_SETTINGS, SEEK_STEP_OPTIONS, STREAM_USER_AGENT_SETTINGS } from '@/types/settings'

export const MIN_EPG_REFRESH_MINUTES = 5
export const MAX_EPG_REFRESH_MINUTES = 1440
const MIN_SUBTITLE_FONT_SIZE = 16
const MAX_SUBTITLE_FONT_SIZE = 48
const MAX_LANGUAGE_TAG_LENGTH = 16
const MAX_TMDB_KEY_LENGTH = 512

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function sanitizeLanguageTag(value: string, fallback: 'auto' | ''): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized.length > MAX_LANGUAGE_TAG_LENGTH) return fallback
  if (normalized === 'auto') return 'auto'

  // Allow common IETF-style tags: tr, en-us, zh-hans, etc.
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized)) return fallback
  return normalized
}

export function clampEpgRefreshInterval(value: number): number {
  return clamp(Math.floor(value), MIN_EPG_REFRESH_MINUTES, MAX_EPG_REFRESH_MINUTES)
}

const EPG_TIME_FORMATS: ReadonlyArray<UserSettings['epgTimeFormat']> = ['12h', '24h']
const LIVE_STREAM_FORMATS: ReadonlyArray<UserSettings['liveStreamFormat']> = ['auto', 'm3u8', 'ts']
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>

/**
 * Keep only keys UserSettings still declares, each with the type its default
 * has. Settings persisted by older builds carry fields that were removed since
 * (theme, language, autoPlay, channelViewMode, bufferLength); dropping them here
 * stops them from riding along in the store forever.
 */
function pickKnownSettings(input: Record<string, unknown>): Partial<UserSettings> {
  const picked: Record<string, unknown> = {}
  for (const key of SETTINGS_KEYS) {
    const value = input[key]
    if (typeof value !== typeof DEFAULT_SETTINGS[key]) continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    if (key === 'epgTimeFormat' && !EPG_TIME_FORMATS.includes(value as UserSettings['epgTimeFormat'])) {
      continue
    }
    if (key === 'streamUserAgent' && !STREAM_USER_AGENT_SETTINGS.includes(value as UserSettings['streamUserAgent'])) {
      continue
    }
    if (
      key === 'liveStreamFormat' &&
      !LIVE_STREAM_FORMATS.includes(value as UserSettings['liveStreamFormat'])
    ) {
      continue
    }
    picked[key] = value
  }
  return picked as Partial<UserSettings>
}

/** Full, valid settings from whatever was persisted (or nothing). */
export function normalizeSettings(raw: unknown): UserSettings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(pickKnownSettings(input)) }
}

function sanitizeSettings(partial: Partial<UserSettings>): Partial<UserSettings> {
  const next: Partial<UserSettings> = { ...partial }

  if (typeof next.epgRefreshInterval === 'number' && Number.isFinite(next.epgRefreshInterval)) {
    next.epgRefreshInterval = clampEpgRefreshInterval(next.epgRefreshInterval)
  }

  if (typeof next.subtitleFontSize === 'number' && Number.isFinite(next.subtitleFontSize)) {
    next.subtitleFontSize = clamp(
      Math.floor(next.subtitleFontSize),
      MIN_SUBTITLE_FONT_SIZE,
      MAX_SUBTITLE_FONT_SIZE
    )
  }

  if (typeof next.preferredAudioLanguage === 'string') {
    next.preferredAudioLanguage = sanitizeLanguageTag(next.preferredAudioLanguage, 'auto')
  }

  if (typeof next.preferredSubtitleLanguage === 'string') {
    next.preferredSubtitleLanguage = sanitizeLanguageTag(next.preferredSubtitleLanguage, 'auto')
  }

  if (typeof next.seekStepSeconds === 'number' && !SEEK_STEP_OPTIONS.includes(next.seekStepSeconds)) {
    next.seekStepSeconds = DEFAULT_SEEK_STEP_SECONDS
  }

  if (typeof next.tmdbApiKey === 'string') {
    next.tmdbApiKey = next.tmdbApiKey.trim().slice(0, MAX_TMDB_KEY_LENGTH)
  }

  return next
}

export interface SettingsSlice {
  settings: UserSettings
  /**
   * The TMDB key in `settings` came from the plain persisted settings of an
   * older version and is not in the secure store yet: it keeps being
   * persisted in plain text until the secure write succeeded.
   */
  tmdbKeyPlainPending: boolean
  updateSettings: (partial: Partial<UserSettings>) => void
  resetSettings: () => void
  setTmdbKeyPlainPending: (pending: boolean) => void
}

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set) => ({
  settings: DEFAULT_SETTINGS,
  tmdbKeyPlainPending: false,
  // Rebuilt from known keys on every write, so leftovers from an older
  // persisted shape disappear the first time anything is changed.
  updateSettings: (partial) =>
    set((state) => ({
      settings: normalizeSettings({ ...state.settings, ...sanitizeSettings(partial) })
    })),
  // The TMDB key is something the user pasted from another site, not a
  // preference; a reset that silently threw it away was data loss.
  resetSettings: () =>
    set((state) => ({ settings: { ...DEFAULT_SETTINGS, tmdbApiKey: state.settings.tmdbApiKey } })),
  setTmdbKeyPlainPending: (pending) => set((state) => (state.tmdbKeyPlainPending === pending ? state : { tmdbKeyPlainPending: pending }))
})
