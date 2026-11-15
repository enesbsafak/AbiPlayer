import { describe, expect, it } from 'vitest'
import { isValidVideoRect, videoMarginRatiosForRect } from './video-rect'

describe('videoMarginRatiosForRect', () => {
  it('turns a rectangle in window pixels into mpv margin ratios', () => {
    expect(videoMarginRatiosForRect({ left: 900, top: 500, width: 300, height: 200 }, { width: 1200, height: 800 })).toEqual({
      left: 0.75,
      right: 0,
      top: 0.625,
      bottom: 0.125
    })
  })

  it('clamps a rectangle that spills over the window', () => {
    const ratios = videoMarginRatiosForRect({ left: 1100, top: 700, width: 300, height: 200 }, { width: 1200, height: 800 })
    expect(ratios).toEqual({ left: 0.9167, right: 0, top: 0.875, bottom: 0 })
  })

  it('refuses an empty window or a rectangle with no picture left', () => {
    expect(videoMarginRatiosForRect({ left: 0, top: 0, width: 10, height: 10 }, { width: 0, height: 800 })).toBeNull()
    expect(videoMarginRatiosForRect({ left: 1200, top: 0, width: 0, height: 100 }, { width: 1200, height: 800 })).toBeNull()
  })
})

describe('isValidVideoRect', () => {
  it('accepts finite, non-negative numbers only', () => {
    expect(isValidVideoRect({ left: 1, top: 2, width: 3, height: 4 })).toBe(true)
    expect(isValidVideoRect({ left: -1, top: 2, width: 3, height: 4 })).toBe(false)
    expect(isValidVideoRect({ left: 1, top: 2, width: Number.NaN, height: 4 })).toBe(false)
    expect(isValidVideoRect({ left: 1, top: 2, width: 3 })).toBe(false)
    expect(isValidVideoRect(null)).toBe(false)
  })
})
