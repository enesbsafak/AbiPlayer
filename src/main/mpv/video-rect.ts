/**
 * Confining mpv's picture to a rectangle of the window (the experimental
 * corner player, plan F2-15). mpv takes margins as fractions of the window
 * (`video-margin-ratio-*`), so a rectangle in window pixels becomes four
 * ratios against the window's content size.
 */

export interface VideoRect {
  left: number
  top: number
  width: number
  height: number
}

export interface VideoMarginRatios {
  left: number
  right: number
  top: number
  bottom: number
}

export const NO_VIDEO_MARGINS: VideoMarginRatios = Object.freeze({ left: 0, right: 0, top: 0, bottom: 0 })

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Rounded so a resize by a pixel does not resend every property. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export function videoMarginRatiosForRect(
  rect: VideoRect,
  window: { width: number; height: number }
): VideoMarginRatios | null {
  if (!(window.width > 0) || !(window.height > 0)) return null
  const left = clampRatio(rect.left / window.width)
  const top = clampRatio(rect.top / window.height)
  const right = clampRatio((window.width - rect.left - rect.width) / window.width)
  const bottom = clampRatio((window.height - rect.top - rect.height) / window.height)
  // mpv needs some picture left over; a degenerate rectangle means "none".
  if (left + right >= 0.99 || top + bottom >= 0.99) return null
  return { left: round(left), right: round(right), top: round(top), bottom: round(bottom) }
}

export function isValidVideoRect(value: unknown): value is VideoRect {
  if (!value || typeof value !== 'object') return false
  const rect = value as Record<string, unknown>
  return (['left', 'top', 'width', 'height'] as const).every(
    (key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]) && (rect[key] as number) >= 0
  )
}
