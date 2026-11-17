import { describe, expect, it } from 'vitest'
import { SUBTITLE_DOCK_GAP_PX, clearanceAbove, overlaySubtitleBottom } from './subtitle-clearance'

describe('clearanceAbove', () => {
  it('is how far the dock top is above the edge, in whole pixels', () => {
    expect(clearanceAbove(720, 560.4)).toBe(160)
  })

  it('is 0 when the dock is not above the edge or nothing was measured', () => {
    expect(clearanceAbove(720, 730)).toBe(0)
    expect(clearanceAbove(Number.NaN, 560)).toBe(0)
  })
})

describe('overlaySubtitleBottom', () => {
  it('keeps the usual place while the controls are hidden', () => {
    expect(overlaySubtitleBottom(720, 0)).toBe(61)
    expect(overlaySubtitleBottom(400, 0)).toBe(44)
  })

  it('sits just above the controls while they are shown', () => {
    expect(overlaySubtitleBottom(720, 180)).toBe(180 + SUBTITLE_DOCK_GAP_PX)
    // Follows the dock's real height: a smaller window, a smaller dock.
    expect(overlaySubtitleBottom(600, 140)).toBe(140 + SUBTITLE_DOCK_GAP_PX)
  })

  it('never goes lower than the usual place', () => {
    expect(overlaySubtitleBottom(1080, 40)).toBe(92)
  })
})
