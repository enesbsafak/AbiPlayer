import type { StateCreator } from 'zustand'
import type { UserSettings } from '@/types/settings'
import { DEFAULT_SETTINGS } from '@/types/settings'

const MIN_EPG_REFRESH_MINUTES = 5
const MAX_EPG_REFRESH_MINUTES = 1440
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

function sanitizeSettings(partial: Partial<UserSettings>): Partial<UserSettings> {
  const next: Partial<UserSettings> = { ...partial }

  if (typeof next.defaultVolume === 'number') {
    next.defaultVolume = clamp(next.defaultVolume, 0, 1)
  }

  if (typeof next.epgRefreshInterval === 'number' && Number.isFinite(next.epgRefreshInterval)) {
    next.epgRefreshInterval = clamp(
      Math.floor(next.epgRefreshInterval),
      MIN_EPG_REFRESH_MINUTES,
      MAX_EPG_REFRESH_MINUTES
    )
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

  if (typeof next.tmdbApiKey === 'string') {
    next.tmdbApiKey = next.tmdbApiKey.trim().slice(0, MAX_TMDB_KEY_LENGTH)
  }

  return next
}

export interface SettingsSlice {
  settings: UserSettings
  updateSettings: (partial: Partial<UserSettings>) => void
  resetSettings: () => void
}

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set) => ({
  settings: DEFAULT_SETTINGS,
  updateSettings: (partial) =>
    set((state) => ({ settings: { ...state.settings, ...sanitizeSettings(partial) } })),
  resetSettings: () => set({ settings: DEFAULT_SETTINGS })
})
