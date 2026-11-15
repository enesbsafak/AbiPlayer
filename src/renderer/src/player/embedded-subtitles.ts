import type { SubtitleCue } from '@/types/player'
import type { EmbeddedSubtitleExtractionResult } from '@/services/platform'
import { parseSubtitles } from '@/services/subtitle-parser'
import { isMediaJobCancelledError } from './media-jobs'
import { strings } from '@/strings'

export const TRUNCATED_SUBTITLE_NOTICE = strings.player.subtitles.truncated

/** `truncated` is optional on the IPC result; absent means complete. */
export function isTruncatedSubtitleExtraction(result: EmbeddedSubtitleExtractionResult): boolean {
  return 'truncated' in result && result.truncated === true
}

export type EmbeddedSubtitleOutcome =
  | { kind: 'cues'; cues: SubtitleCue[]; notice: string | null }
  /** The file has no cues for that stream. */
  | { kind: 'empty' }
  /** Superseded or cancelled: apply nothing, report nothing. */
  | { kind: 'stale' }
  | { kind: 'failed'; error: unknown }

/** Extracts one subtitle stream of a direct file and parses it into cues. */
export async function loadEmbeddedSubtitle(
  extract: () => Promise<EmbeddedSubtitleExtractionResult | null>,
  isCurrent: () => boolean
): Promise<EmbeddedSubtitleOutcome> {
  try {
    const extracted = await extract()
    if (!isCurrent()) return { kind: 'stale' }
    if (!extracted) return { kind: 'empty' }
    const cues = parseSubtitles(extracted.content, `embedded.${extracted.format}`)
    return { kind: 'cues', cues, notice: isTruncatedSubtitleExtraction(extracted) ? TRUNCATED_SUBTITLE_NOTICE : null }
  } catch (error) {
    if (!isCurrent() || isMediaJobCancelledError(error)) return { kind: 'stale' }
    return { kind: 'failed', error }
  }
}

/** Cues showing at `time`, for subtitle sources the player parsed itself. */
export function activeCuesAt(cues: SubtitleCue[], time: number): SubtitleCue[] {
  return cues.filter((cue) => time >= cue.startTime && time <= cue.endTime)
}
