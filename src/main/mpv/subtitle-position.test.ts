import { describe, expect, it } from 'vitest'
import {
  MAX_SUBTITLE_INSET_RATIO,
  subPosForInset,
  subtitleInsetRatio,
  subtitlePositionProperties
} from './subtitle-position'

describe('subtitleInsetRatio', () => {
  it('is the inset as a share of the window height', () => {
    expect(subtitleInsetRatio(150, 720)).toBeCloseTo(0.2083, 4)
    expect(subtitleInsetRatio(0, 720)).toBe(0)
  })

  it('treats a negative inset as none and caps a huge one', () => {
    expect(subtitleInsetRatio(-20, 720)).toBe(0)
    expect(subtitleInsetRatio(5000, 720)).toBe(MAX_SUBTITLE_INSET_RATIO)
  })

  it('is 0 without a usable window height or inset', () => {
    expect(subtitleInsetRatio(150, 0)).toBe(0)
    expect(subtitleInsetRatio(150, Number.NaN)).toBe(0)
    expect(subtitleInsetRatio(Number.POSITIVE_INFINITY, 720)).toBe(0)
  })
})

describe('subPosForInset', () => {
  it('leaves subtitles where they are without an inset', () => {
    expect(subPosForInset(0)).toBe(100)
    expect(subPosForInset(Number.NaN)).toBe(100)
  })

  // 150 px of a 720 px window: measured on mpv 0.42, sub-pos 78.13 raised a
  // text subtitle by 150 px at 720 and by 225 px (the same share) at 1080.
  it('raises a text subtitle by the inset, measured above the bottom margin', () => {
    expect(subPosForInset(150 / 720)).toBe(78.13)
  })

  it('never goes past the top', () => {
    expect(subPosForInset(1)).toBeGreaterThanOrEqual(0)
    expect(subPosForInset(MAX_SUBTITLE_INSET_RATIO)).toBeGreaterThanOrEqual(0)
  })

  it('only moves up as the inset grows', () => {
    expect(subPosForInset(0.1)).toBeGreaterThan(subPosForInset(0.2))
  })
})

describe('subtitlePositionProperties', () => {
  it('is sub-pos alone (it also moves image subtitles; the margins do not)', () => {
    expect(subtitlePositionProperties(0)).toEqual([['sub-pos', 100]])
    expect(subtitlePositionProperties(150 / 720)).toEqual([['sub-pos', 78.13]])
  })
})
