import { describe, expect, it } from 'vitest'
import { gridColumns, nextGridIndex } from './grid-keyboard'

// 10 items in rows of 4:  0 1 2 3 / 4 5 6 7 / 8 9
const grid = { count: 10, columns: 4, pageRows: 2 }
const press = (current: number, key: string, extra: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) =>
  nextGridIndex(current, { key, ...extra }, grid)

describe('nextGridIndex', () => {
  it('moves left and right in reading order, across rows, stopping at the ends', () => {
    expect(press(1, 'ArrowRight')).toBe(2)
    expect(press(3, 'ArrowRight')).toBe(4)
    expect(press(4, 'ArrowLeft')).toBe(3)
    expect(press(0, 'ArrowLeft')).toBe(0)
    expect(press(9, 'ArrowRight')).toBe(9)
  })

  it('moves up and down by a row and keeps the column', () => {
    expect(press(1, 'ArrowDown')).toBe(5)
    expect(press(5, 'ArrowUp')).toBe(1)
    expect(press(2, 'ArrowUp')).toBe(2)
  })

  it('lands on the last item when the row below is shorter', () => {
    expect(press(7, 'ArrowDown')).toBe(9)
    expect(press(6, 'ArrowDown')).toBe(9)
    expect(press(9, 'ArrowDown')).toBe(9)
  })

  it('pages by whole screens and clamps', () => {
    expect(press(1, 'PageDown')).toBe(9)
    expect(press(0, 'PageDown')).toBe(8)
    expect(press(9, 'PageUp')).toBe(1)
    expect(press(2, 'PageUp')).toBe(0)
  })

  it('goes to the row ends with Home and End, to the list ends with Ctrl', () => {
    expect(press(6, 'Home')).toBe(4)
    expect(press(5, 'End')).toBe(7)
    expect(press(8, 'End')).toBe(9)
    expect(press(6, 'Home', { ctrlKey: true })).toBe(0)
    expect(press(1, 'End', { ctrlKey: true })).toBe(9)
  })

  it('leaves other keys and modified arrows alone', () => {
    expect(press(1, 'Enter')).toBeNull()
    expect(press(1, 'a')).toBeNull()
    expect(press(1, 'ArrowRight', { shiftKey: true })).toBeNull()
    expect(press(1, 'ArrowDown', { altKey: true })).toBeNull()
    expect(press(1, 'ArrowDown', { ctrlKey: true })).toBeNull()
    expect(nextGridIndex(0, { key: 'ArrowRight' }, { ...grid, count: 0 })).toBeNull()
  })

  it('works as a list with one column', () => {
    const list = { count: 3, columns: 1, pageRows: 10 }
    expect(nextGridIndex(0, { key: 'ArrowDown' }, list)).toBe(1)
    expect(nextGridIndex(2, { key: 'ArrowDown' }, list)).toBe(2)
    expect(nextGridIndex(2, { key: 'ArrowUp' }, list)).toBe(1)
    expect(nextGridIndex(1, { key: 'End' }, list)).toBe(1)
    expect(nextGridIndex(1, { key: 'End', ctrlKey: true }, list)).toBe(2)
  })

  it('clamps a stale index after the list shrank', () => {
    expect(press(40, 'ArrowLeft')).toBe(8)
  })
})

describe('gridColumns', () => {
  const layout = { minCardWidth: 178, maxColumns: 10, gap: 14 }

  it('fits as many minimum-width cards as the width allows, within bounds', () => {
    expect(gridColumns(1024, layout)).toBe(5)
    expect(gridColumns(200, layout)).toBe(2)
    expect(gridColumns(10_000, layout)).toBe(10)
  })
})
