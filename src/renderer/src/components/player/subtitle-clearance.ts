/*
 * Subtitles move up out of the controls' way while those are shown. The
 * distance comes from where the dock actually is, which changes with the
 * window (the dock's controls row has several sizes, short windows have
 * tighter padding, a tall one adds the key hints).
 */

/** Between the top of the controls and the bottom of a subtitle drawn over the page (HTML5 engine). */
export const SUBTITLE_DOCK_GAP_PX = 16

/** How far above `bottomEdge` the dock's top edge is, in whole CSS pixels; 0 when it is not above. */
export function clearanceAbove(bottomEdge: number, dockTop: number): number {
  if (!Number.isFinite(bottomEdge) || !Number.isFinite(dockTop)) return 0
  return Math.max(0, Math.round(bottomEdge - dockTop))
}

/**
 * The bottom offset of the subtitles the page draws itself: their usual
 * place, or just above the controls when those are shown (`dockClearance`
 * is 0 while they are hidden).
 */
export function overlaySubtitleBottom(playerHeight: number, dockClearance: number, positionPercent = 0): number {
  // The viewer's own height (a share of the picture) goes on top of the usual place.
  const raised = positionPercent > 0 ? Math.round((playerHeight * positionPercent) / 100) : 0
  const usual = Math.max(44, Math.round(playerHeight * 0.085)) + raised
  if (!(dockClearance > 0)) return usual
  return Math.max(usual, Math.round(dockClearance) + SUBTITLE_DOCK_GAP_PX)
}

/** The page-drawn subtitle's outline as a text shadow: the nearest thing CSS has to mpv's border. */
export function overlaySubtitleShadow(outline: 'auto' | 'thin' | 'thick'): string {
  if (outline === 'auto') return '1px 1px 2px rgba(0,0,0,0.8)'
  const size = outline === 'thin' ? 1 : 2
  return [
    `${size}px 0 0 #000`,
    `-${size}px 0 0 #000`,
    `0 ${size}px 0 #000`,
    `0 -${size}px 0 #000`,
    `${size}px ${size}px 0 #000`,
    `-${size}px -${size}px 0 #000`,
    `${size}px -${size}px 0 #000`,
    `-${size}px ${size}px 0 #000`
  ].join(', ')
}
