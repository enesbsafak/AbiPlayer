/*
 * Lifting subtitles above the player's controls while they are shown.
 *
 * Measured on single frames of the bundled mpv (0.42, --vo=image) with the
 * app's options (--no-osc, --load-scripts=no, sub-ass-override=force):
 *
 * - `sub-margin-y` and `sub-margin-y-offset` move text subtitles only. Image
 *   subtitles (PGS, DVB, DVD) stay where the stream put them.
 * - `sub-pos` moves both, as long as sub-ass-override is not "no". Image
 *   subtitles move by (100 - pos) % of the picture height; text subtitles by
 *   (100 - pos) % of the window height less the bottom margin (`sub-margin-y`,
 *   34 scaled pixels of a 720 px high window by default).
 *
 * So `sub-pos` it is, worked out so a text subtitle rises by exactly the
 * inset: it then keeps its usual margin, measured from the top of the
 * controls instead of the window's edge. An image subtitle rises about 5 %
 * more than that, which only keeps it clear of the controls.
 */

/** mpv's own `sub-margin-y` (scaled pixels); the app does not change it. */
export const MPV_DEFAULT_SUB_MARGIN_Y = 34
/** The window height mpv's scaled pixels are relative to. */
const MPV_SCALED_HEIGHT = 720
/** Never more than this share of the window: some room is left for the subtitle itself. */
export const MAX_SUBTITLE_INSET_RATIO = 0.9

/** The inset as a fraction of the window height, 0 when either is unusable. */
export function subtitleInsetRatio(insetPx: number, windowHeight: number): number {
  if (!Number.isFinite(insetPx) || !Number.isFinite(windowHeight) || windowHeight <= 0) return 0
  return Math.max(0, Math.min(MAX_SUBTITLE_INSET_RATIO, insetPx / windowHeight))
}

/** The `sub-pos` that raises a text subtitle by `insetRatio` of the window height. */
export function subPosForInset(insetRatio: number): number {
  const ratio = Number.isFinite(insetRatio) ? Math.max(0, Math.min(MAX_SUBTITLE_INSET_RATIO, insetRatio)) : 0
  if (ratio === 0) return 100
  const heightAboveMargin = 1 - MPV_DEFAULT_SUB_MARGIN_Y / MPV_SCALED_HEIGHT
  const pos = 100 - (100 * ratio) / heightAboveMargin
  // Hundredths: finer than a pixel, coarse enough not to resend noise.
  return Math.round(Math.max(0, Math.min(100, pos)) * 100) / 100
}

/** The mpv properties that place subtitles `insetRatio` of the window above their usual spot. */
export function subtitlePositionProperties(insetRatio: number): Array<[string, unknown]> {
  return [['sub-pos', subPosForInset(insetRatio)]]
}
