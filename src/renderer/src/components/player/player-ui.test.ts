import { describe, expect, it } from 'vitest'
import { dockSizeFor, rowWidth, type DockParts } from './player-ui'

// The dock's inner width in a few windows: the column is capped at 1480 px,
// the gutter is 16 px a side (12 in a short window), the dock's padding 14 px
// a side, and the open channel list takes 288 px.
const INNER = {
  fullHd: 1480 - 28,
  smallest: 900 - 24 - 28,
  smallestWithList: 900 - 288 - 24 - 28
}

const live: DockParts = { seeks: false, pickers: 2, pip: false }
const filmEveryPicker: DockParts = { seeks: true, pickers: 4, pip: false }
const filmHtml5: DockParts = { seeks: true, pickers: 1, pip: true }

describe('rowWidth', () => {
  it('adds the parts as the classes draw them, with an 8 px gap after each', () => {
    // Steps 44 + 44, play 52 + 8, volume 4 + 44 + 6 + 88; two pickers, the list and fullscreen at 44.
    expect(rowWidth('s', live)).toBe(44 + 44 + 60 + 142 + 44 * 4 + 8 * 8)
    expect(rowWidth('xs', filmEveryPicker)).toBe(596)
  })

  it('gets narrower at every smaller size', () => {
    for (const parts of [live, filmEveryPicker, filmHtml5]) {
      expect(rowWidth('l', parts)).toBeGreaterThan(rowWidth('m', parts))
      expect(rowWidth('m', parts)).toBeGreaterThan(rowWidth('s', parts))
      expect(rowWidth('s', parts)).toBeGreaterThan(rowWidth('xs', parts))
    }
  })
})

describe('dockSizeFor', () => {
  it('picks the largest size whose row fits', () => {
    expect(dockSizeFor(INNER.fullHd, live)).toBe('l')
    expect(dockSizeFor(INNER.fullHd, filmHtml5)).toBe('l')
    expect(dockSizeFor(INNER.fullHd, filmEveryPicker)).toBe('m')
    expect(dockSizeFor(INNER.smallest, live)).toBe('m')
    expect(dockSizeFor(INNER.smallest, filmEveryPicker)).toBe('s')
  })

  it('keeps a live channel above the narrowest size in the smallest window with the list open', () => {
    expect(dockSizeFor(INNER.smallestWithList, live)).toBe('s')
  })

  it('never picks a size whose row is wider than the dock, and falls back to xs', () => {
    for (let width = 0; width <= 1600; width += 4) {
      for (const parts of [live, filmEveryPicker, filmHtml5]) {
        const size = dockSizeFor(width, parts)
        if (size !== 'xs') expect(rowWidth(size, parts)).toBeLessThanOrEqual(width)
      }
    }
    expect(dockSizeFor(0, live)).toBe('xs')
  })
})
