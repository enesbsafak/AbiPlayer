import { useCallback, useState } from 'react'
import { useStore } from '@/store'
import { mpvAddSubtitleFile, pickAndReadFile } from '@/services/platform'
import { parseSubtitles } from '@/services/subtitle-parser'

export const SUBTITLE_FILE_READ_ERROR =
  'Altyazı dosyası okunamadı. Dosya çok büyük ya da erişilemez olabilir.'
export const SUBTITLE_FILE_ADD_ERROR = 'Altyazı dosyası oynatıcıya eklenemedi.'
export const SUBTITLE_FILE_EMPTY_ERROR = 'Dosyada okunabilir altyazı bulunamadı.'

const SUBTITLE_FILE_FILTERS = [
  { name: 'Altyazı Dosyaları', extensions: ['srt', 'vtt', 'ass', 'ssa'] }
]

export type ExternalSubtitleLoadResult = 'loaded' | 'cancelled' | 'failed'

/**
 * Picks a subtitle file and hands it to whichever engine is playing. Every way
 * this can fail used to end in silence (the menu just closed), so each one now
 * leaves a message for the menu to show.
 */
export function useExternalSubtitleLoader() {
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<ExternalSubtitleLoadResult> => {
    setError(null)

    let file: { path: string; content: string } | null
    try {
      file = await pickAndReadFile(SUBTITLE_FILE_FILTERS)
    } catch {
      setError(SUBTITLE_FILE_READ_ERROR)
      return 'failed'
    }
    if (!file) return 'cancelled'

    const store = useStore.getState()
    if (store.playbackEngine === 'mpv') {
      let trackId: number | null
      try {
        trackId = await mpvAddSubtitleFile(file.path)
      } catch {
        trackId = null
      }
      if (trackId === null) {
        setError(SUBTITLE_FILE_ADD_ERROR)
        return 'failed'
      }
      store.applyPlayerPatch({ subtitleCues: [], activeSubtitleCues: [] })
      store.selectSubtitleTrack(`mpv-s:${trackId}`)
      return 'loaded'
    }

    let cues: ReturnType<typeof parseSubtitles>
    try {
      cues = parseSubtitles(file.content, file.path)
    } catch {
      cues = []
    }
    if (cues.length === 0) {
      setError(SUBTITLE_FILE_EMPTY_ERROR)
      return 'failed'
    }
    store.setSubtitleCues(cues)
    store.selectSubtitleTrack('external')
    return 'loaded'
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { load, error, clearError }
}
