import { useMemo } from 'react'
import { useStore } from '@/store'
import { collectTrackLanguages } from '@/services/track-preferences'

export const COMMON_LANGUAGE_CODES = ['tr', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'ar']

let turkishLanguageDisplayNames: Intl.DisplayNames | null = null

try {
  turkishLanguageDisplayNames = new Intl.DisplayNames(['tr'], { type: 'language' })
} catch {
  turkishLanguageDisplayNames = null
}

export function formatLanguageLabel(code: string): string {
  const normalized = code.trim().toLowerCase()
  if (!normalized) return 'Bilinmiyor'

  try {
    const languagePart = normalized.split('-')[0]
    const display = turkishLanguageDisplayNames?.of(languagePart)
    return display ? `${display} (${normalized.toUpperCase()})` : normalized.toUpperCase()
  } catch {
    return normalized.toUpperCase()
  }
}

/**
 * Language codes offered in the preference dropdowns: the common ones, plus
 * whatever the currently loaded stream actually carries. Reading the live track
 * lists is why a provider's own language tags show up as choices at all.
 */
export function useLanguageCodes(): string[] {
  const audioTracks = useStore((s) => s.audioTracks)
  const subtitleTracks = useStore((s) => s.subtitleTracks)

  return useMemo(() => {
    const trackLanguages = collectTrackLanguages([...audioTracks, ...subtitleTracks])
    return Array.from(new Set([...trackLanguages, ...COMMON_LANGUAGE_CODES]))
  }, [audioTracks, subtitleTracks])
}
