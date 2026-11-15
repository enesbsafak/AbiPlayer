import { useCallback, useState } from 'react'
import { useStore } from '@/store'
import { mpvAddSubtitleFile, pickAndReadFile } from '@/services/platform'
import { parseSubtitles } from '@/services/subtitle-parser'
import { strings } from '@/strings'

export const SUBTITLE_FILE_READ_ERROR = strings.player.subtitles.fileReadFailed
export const SUBTITLE_FILE_ADD_ERROR = strings.player.subtitles.fileAddFailed
export const SUBTITLE_FILE_EMPTY_ERROR = strings.player.subtitles.fileEmpty

const SUBTITLE_FILE_FILTERS = [
  { name: strings.player.subtitles.fileFilter, extensions: ['srt', 'vtt', 'ass', 'ssa'] }
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
      const selected = `mpv-s:${trackId}`
      const mediaKey = useStore.getState().currentPlayback?.mediaKey ?? null
      store.applyPlayerPatch({
        subtitleCues: [],
        activeSubtitleCues: [],
        // mpv holds the file for this load only; a new load of the item adds it again.
        externalSubtitle: mediaKey ? { mediaKey, path: file.path, trackId: selected } : null
      })
      store.selectSubtitleTrack(selected)
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
    // The parsed cues are the file: they stay with the item on their own.
    store.applyPlayerPatch({ subtitleCues: cues, externalSubtitle: null })
    store.selectSubtitleTrack('external')
    return 'loaded'
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { load, error, clearError }
}
