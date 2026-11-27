/**
 * The choices of the subtitle appearance settings, shared by the settings
 * (renderer) and by main, which checks a style before mpv gets it.
 */

/**
 * Font families offered for subtitles; '' is the engine's default sans-serif.
 * All of them come with Windows, so mpv finds them without a font being shipped.
 */
export const SUBTITLE_FONTS: readonly string[] = [
  '',
  'Arial',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Consolas'
]

/**
 * The outline around the letters. 'auto' is what it always was: none over a
 * background box, a normal one when the background is fully transparent.
 */
export type SubtitleOutline = 'auto' | 'thin' | 'thick'

export const SUBTITLE_OUTLINES: readonly SubtitleOutline[] = ['auto', 'thin', 'thick']

/** How far subtitles can be raised from their usual place: percent of the picture's height. */
export const MAX_SUBTITLE_POSITION = 30

export function isSubtitleFont(value: unknown): value is string {
  return typeof value === 'string' && SUBTITLE_FONTS.includes(value)
}

export function isSubtitleOutline(value: unknown): value is SubtitleOutline {
  return typeof value === 'string' && (SUBTITLE_OUTLINES as readonly string[]).includes(value)
}

/** A whole percent within the allowed range; 0 for anything else. */
export function clampSubtitlePosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_SUBTITLE_POSITION, Math.round(value)))
}
