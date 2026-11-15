import { describe, expect, it } from 'vitest'
import { pickInDirection, type Box } from './spatial-focus'
import { layoutHome, postersThatFit, rowsThatFit } from './HomeRows'
import { entryGrid } from './HomeChannelPanel'

const box = (left: number, top: number, width = 100, height = 100): Box => ({ left, top, width, height })

describe('pickInDirection (home arrow keys)', () => {
  // The home layout in miniature: a tall tile on the left, a 2 × 2 grid on the right.
  const hero = box(0, 0, 200, 220)
  const tiles = [box(220, 0), box(340, 0), box(220, 120), box(340, 120)]

  it('moves across into the grid and back', () => {
    expect(pickInDirection(hero, tiles, 'right')).toBe(0)
    expect(pickInDirection(tiles[2]!, [hero, ...tiles], 'left')).toBe(0)
  })

  it('prefers the box straight ahead to a nearer one off to the side', () => {
    expect(pickInDirection(tiles[0]!, tiles, 'down')).toBe(2)
    expect(pickInDirection(tiles[0]!, tiles, 'right')).toBe(1)
  })

  it('stops at the edge', () => {
    expect(pickInDirection(tiles[1]!, tiles, 'right')).toBeNull()
    expect(pickInDirection(tiles[0]!, tiles, 'up')).toBeNull()
  })
})

describe('postersThatFit', () => {
  it('fits whole posters only, gaps between them', () => {
    expect(postersThatFit(0, 132)).toBe(0)
    expect(postersThatFit(131, 132)).toBe(0)
    expect(postersThatFit(132, 132)).toBe(1)
    expect(postersThatFit(132 * 5 + 20 * 4, 132)).toBe(5)
    expect(postersThatFit(132 * 5 + 20 * 4 - 1, 132)).toBe(4)
  })
})

describe('rowsThatFit', () => {
  it('takes rows in order while each fits whole, passing over one too tall for a shorter one', () => {
    expect(rowsThatFit(159, [226, 160], 20)).toEqual([])
    expect(rowsThatFit(225, [226, 160], 20)).toEqual([1])
    expect(rowsThatFit(226, [226, 160], 20)).toEqual([0])
    expect(rowsThatFit(406, [226, 160], 20)).toEqual([0, 1])
    expect(rowsThatFit(472, [226, 226, 160], 20)).toEqual([0, 1])
    expect(rowsThatFit(420, [226, 226, 160], 20)).toEqual([0, 2])
    expect(rowsThatFit(900, [], 20)).toEqual([])
  })
})

describe('layoutHome', () => {
  const poster = 264
  const logo = 198

  it('keeps the block near its design at 1280 × 800 and draws the film row with its heading', () => {
    // 800 minus the bar (72) and the page's padding (36).
    expect(layoutHome(692, [poster, poster, logo], false)).toEqual({ block: 404, rows: [0], gap: 24 })
  })

  it('fits the smallest window: a smaller block and one short row', () => {
    // 600 minus the bar (68) and the padding (28) of a short window.
    expect(layoutHome(504, [212, 212], true)).toEqual({ block: 272, rows: [0], gap: 20 })
  })

  it('spends a tall window on rows, then on a taller block (at most 1.25 ×)', () => {
    const layout = layoutHome(1332, [poster, poster, poster, logo], false)
    expect(layout.rows).toEqual([0, 1, 2])
    expect(layout.block).toBe(468)
    expect(layout.gap).toBe(24)
  })

  it('leaves room for the footer when there is no row', () => {
    expect(layoutHome(692, [], false)).toEqual({ block: 530, rows: [], gap: 24 })
  })

  it('then on evenly wider gaps, at most doubled', () => {
    // Block at its 530 cap with room to spare: the three gaps take it, up to 48.
    expect(layoutHome(1500, [poster, poster, poster], false)).toEqual({ block: 530, rows: [0, 1, 2], gap: 48 })
  })
})

describe('entryGrid (channel panel)', () => {
  it('fits whole entries only', () => {
    expect(entryGrid(320, 300)).toEqual({ columns: 1, rows: 4 })
    expect(entryGrid(848, 380)).toEqual({ columns: 3, rows: 5 })
    expect(entryGrid(0, 300)).toEqual({ columns: 0, rows: 0 })
  })
})

describe('layoutHome giving way', () => {
  it('shortens the block a little (not under 380) to fit one more whole row', () => {
    // 1920 × 1080: two poster rows fit only with a 388 px block.
    expect(layoutHome(972, [268, 268, 268], false)).toEqual({ block: 388, rows: [0, 1], gap: 24 })
    // Not when it would take more than that.
    expect(layoutHome(940, [268, 268], false).rows).toEqual([0])
  })
})
