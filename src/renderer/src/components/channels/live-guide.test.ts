import { describe, expect, it } from 'vitest'
import { channelInitial, minutesLeft, programmeProgress } from './live-guide'

const program = { channelId: 'a', title: 'Haber', start: 0, end: 60 * 60_000 }

describe('channel initial (the picture of a channel without a logo)', () => {
  it('skips a country prefix and keeps Turkish capitals', () => {
    expect(channelInitial('FR: Movies Planet 4K')).toBe('M')
    expect(channelInitial('TR | ilk Kanal')).toBe('İ')
    expect(channelInitial('24 Haber')).toBe('2')
    expect(channelInitial('---')).toBe('·')
  })
})

describe('programme progress', () => {
  it('is the share gone and the minutes left', () => {
    expect(programmeProgress(program, 15 * 60_000)).toBe(25)
    expect(programmeProgress(program, 2 * 60 * 60_000)).toBe(100)
    expect(minutesLeft(program, 15 * 60_000)).toBe(45)
  })
})
