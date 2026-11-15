import { describe, expect, it } from 'vitest'
import type { EPGProgram } from '@/types/epg'
import { clockLocativeSuffix } from '@/strings/epg'
import {
  GAP_LABEL_MIN_MS,
  HEADER_HEIGHT,
  HOUR_MS,
  MINUTE_MS,
  ROW_PITCH,
  calendarDayOffset,
  channelColumnWidth,
  defaultViewStart,
  drawWindow,
  firstEndingAfter,
  indexAtTime,
  indexByStart,
  neighbourIndex,
  programProgress,
  programTiming,
  revealScrollLeft,
  revealScrollTop,
  segmentsInWindow,
  timeToX,
  timelineRange,
  xToTime
} from './guide-model'

const T0 = new Date(2026, 10, 15, 20, 0).getTime()
const at = (hours: number, minutes = 0) => T0 + hours * HOUR_MS + minutes * MINUTE_MS

function program(title: string, start: number, end: number): EPGProgram {
  return { channelId: 'c', title, start, end }
}

// 20:00–21:00, 21:00–22:00, (gap 22:00–23:00), 23:00–23:10, (gap 23:10–23:30), 23:30–01:00
const ROW: EPGProgram[] = [
  program('A', at(0), at(1)),
  program('B', at(1), at(2)),
  program('C', at(3), at(3, 10)),
  program('D', at(3, 30), at(5))
]
const WHOLE = { start: at(-6), end: at(30) }

describe('timeline geometry', () => {
  it('opens on the half hour before now, and maps time to pixels and back', () => {
    expect(defaultViewStart(at(0, 42))).toBe(at(0))
    expect(defaultViewStart(at(0, 5))).toBe(at(-1, 30))
    expect(timeToX(at(1), at(0))).toBe(420)
    expect(xToTime(420, at(0))).toBe(at(1))
  })

  it('spans the guide in whole hours, within six hours back and two days ahead, and at least the view', () => {
    const now = at(0, 42)
    expect(timelineRange([{ programs: ROW }], now)).toEqual({ start: at(0), end: at(5) })
    const long = [{ programs: [program('old', at(-20), at(-19)), program('far', at(70), at(71))] }]
    expect(timelineRange(long, now)).toEqual({ start: at(-6), end: at(49) })
    expect(timelineRange([], now, 10 * HOUR_MS)).toEqual({ start: at(0), end: at(10) })
  })

  it('draws the visible time plus an hour each side, snapped to half hours', () => {
    expect(drawWindow(at(0, 10), at(2, 40))).toEqual({ from: at(-1), to: at(4) })
    expect(drawWindow(at(0, 20), at(2, 50))).toEqual(drawWindow(at(0, 10), at(2, 40)))
  })

  it('narrows the channel column in a small window', () => {
    expect(channelColumnWidth(852)).toBeLessThan(channelColumnWidth(1232))
    expect(channelColumnWidth(2512)).toBeGreaterThanOrEqual(channelColumnWidth(1232))
  })
})

describe('row segments', () => {
  it('lists only the programmes in the drawn window', () => {
    const segments = segmentsInWindow(ROW, { from: at(1, 30), to: at(3, 5) }, WHOLE)
    expect(segments.map((segment) => (segment.kind === 'program' ? segment.program.title : 'gap'))).toEqual(['B', 'gap', 'C'])
  })

  it('labels empty stretches only when they are long enough', () => {
    const gaps = segmentsInWindow(ROW, { from: at(0), to: at(5) }, WHOLE).filter((segment) => segment.kind === 'gap')
    // 22:00–23:00 is labelled, 23:10–23:30 is too short.
    expect(gaps).toEqual([{ kind: 'gap', start: at(2), end: at(3) }])
    expect(GAP_LABEL_MIN_MS).toBe(30 * MINUTE_MS)
  })

  it('labels the stretch before the first and after the last programme, clipped to the range', () => {
    const segments = segmentsInWindow(ROW, { from: at(-2), to: at(7) }, { start: at(-1), end: at(6) })
    expect(segments[0]).toEqual({ kind: 'gap', start: at(-1), end: at(0) })
    expect(segments.at(-1)).toEqual({ kind: 'gap', start: at(5), end: at(6) })
  })

  it('finds programmes by binary search', () => {
    expect(firstEndingAfter(ROW, at(1))).toBe(1)
    expect(firstEndingAfter(ROW, at(9))).toBe(4)
    expect(indexByStart(ROW, at(3))).toBe(2)
    expect(indexByStart(ROW, at(3, 1))).toBe(-1)
  })
})

describe('keyboard movement', () => {
  it('moves left and right along a row and stops at the range', () => {
    expect(neighbourIndex(ROW, 1, 1, WHOLE)).toBe(2)
    expect(neighbourIndex(ROW, 0, -1, WHOLE)).toBe(-1)
    expect(neighbourIndex(ROW, 2, 1, { start: at(0), end: at(3, 20) })).toBe(-1)
  })

  it('moves up and down to the programme on at the same time, or the nearest one', () => {
    expect(indexAtTime(ROW, at(1, 30), WHOLE)).toBe(1)
    expect(indexAtTime(ROW, at(2, 10), WHOLE)).toBe(1) // in the gap, nearer B's end
    expect(indexAtTime(ROW, at(2, 50), WHOLE)).toBe(2) // nearer C's start
    expect(indexAtTime(ROW, at(9), WHOLE)).toBe(3)
    expect(indexAtTime([], at(0), WHOLE)).toBe(-1)
  })

  it('scrolls a block into view only when too little of it shows', () => {
    // A block fully in view stays.
    expect(revealScrollLeft(100, 300, 0, 1000)).toBeNull()
    // To the right: its end comes in at the right edge.
    expect(revealScrollLeft(1100, 1300, 0, 1000)).toBe(324)
    // To the left: its start comes in at the left edge.
    expect(revealScrollLeft(100, 300, 900, 1000)).toBe(76)
    // A long programme that is mostly in view does not jump to its start.
    expect(revealScrollLeft(-2000, 800, 0, 1000)).toBeNull()
  })

  it('keeps a row below the sticky header', () => {
    expect(revealScrollTop(0, 0, 400)).toBeNull()
    expect(revealScrollTop(10, 0, 400)).toBe(HEADER_HEIGHT + 11 * ROW_PITCH - 400)
    expect(revealScrollTop(2, 5 * ROW_PITCH, 400)).toBe(2 * ROW_PITCH)
  })
})

describe('programme state', () => {
  it('says whether a programme is on, still to come or over, and how far it has got', () => {
    expect(programTiming(ROW[0]!, at(0, 30))).toBe('live')
    expect(programTiming(ROW[1]!, at(0, 30))).toBe('upcoming')
    expect(programTiming(ROW[0]!, at(1))).toBe('ended')
    expect(programProgress(ROW[0]!, at(0, 15))).toBe(25)
    expect(programProgress(ROW[0]!, at(4))).toBe(100)
  })

  it('names the day relative to today', () => {
    expect(calendarDayOffset(at(3, 59), at(0))).toBe(0)
    expect(calendarDayOffset(at(4, 1), at(0))).toBe(1)
    expect(calendarDayOffset(at(-21), at(0))).toBe(-1)
  })

  it('reads clock times with the right Turkish suffix', () => {
    const say = (hour: number, minute: number) => clockLocativeSuffix(hour, minute)
    expect(say(21, 30)).toBe('da')
    expect(say(20, 15)).toBe('te')
    expect(say(21, 0)).toBe('de')
    expect(say(20, 0)).toBe('de')
    expect(say(10, 0)).toBe('da')
    expect(say(0, 0)).toBe('da')
    expect(say(21, 40)).toBe('ta')
    expect(say(21, 5)).toBe('te')
    expect(say(21, 9)).toBe('da')
  })
})
