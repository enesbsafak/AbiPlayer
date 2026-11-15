import { describe, expect, it } from 'vitest'
import { CORNER_GAP_PX, CORNER_MAX_WIDTH_PX, CORNER_MIN_WIDTH_PX, clipPathOutside, cornerPlayerRect } from './corner-rect'

describe('cornerPlayerRect', () => {
  it('puts a 16:9 quarter-width rectangle in the bottom-right corner', () => {
    const rect = cornerPlayerRect({ width: 1600, height: 900 })
    expect(rect).toEqual({ width: 400, height: 225, left: 1600 - CORNER_GAP_PX - 400, top: 900 - CORNER_GAP_PX - 225 })
  })

  it('keeps the width within limits', () => {
    expect(cornerPlayerRect({ width: 900, height: 600 }).width).toBe(CORNER_MIN_WIDTH_PX)
    expect(cornerPlayerRect({ width: 3840, height: 2160 }).width).toBe(CORNER_MAX_WIDTH_PX)
  })

  it('never leaves the window', () => {
    const rect = cornerPlayerRect({ width: 200, height: 100 })
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.width).toBeLessThanOrEqual(200)
  })
})

describe('clipPathOutside', () => {
  it('cuts exactly the rectangle out of the page', () => {
    expect(clipPathOutside({ left: 10, top: 20, width: 300, height: 100 })).toBe(
      'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, 10px 20px, 310px 20px, 310px 120px, 10px 120px, 10px 20px)'
    )
  })
})
