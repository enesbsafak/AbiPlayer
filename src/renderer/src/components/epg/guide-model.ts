import type { CatalogItem } from '@/catalog/types'
import type { EPGProgram } from '@/types/epg'

/** One channel of the guide with its programmes, sorted by start. */
export interface GuideRow {
  channel: CatalogItem
  programs: EPGProgram[]
}

/** The focused programme, by row and by index into that row's programmes. */
export interface GuideFocus {
  rowIndex: number
  index: number
}

/*
 * The timeline guide's geometry and the pure parts of its behaviour: which
 * stretch of time it spans, which programmes and empty stretches of a row
 * fall inside the drawn time window, and where the arrow keys go.
 *
 * Programme lists are sorted by start (the parser sorts them; the current
 * programme is found by binary search elsewhere too), so everything here
 * searches instead of scanning a whole row.
 */

export const MINUTE_MS = 60_000
export const HALF_HOUR_MS = 30 * MINUTE_MS
export const HOUR_MS = 60 * MINUTE_MS

/** Horizontal scale: about two and a half hours across the designed 1280 px window. */
export const PX_PER_MINUTE = 7
/** A programme block's height, and the space between rows. */
export const ROW_HEIGHT = 52
export const ROW_PITCH = 58
/** The sticky time header above the rows. */
export const HEADER_HEIGHT = 36
/** Empty stretches shorter than this stay blank; longer ones say there is no guide data. */
export const GAP_LABEL_MIN_MS = 30 * MINUTE_MS
/** Drawn beyond each side of the visible time, so short scrolls need no new blocks. */
const WINDOW_OVERSCAN_MS = HOUR_MS
/** How far back and ahead of now the timeline reaches at most. */
const MAX_PAST_MS = 6 * HOUR_MS
const MAX_FUTURE_MS = 48 * HOUR_MS

/** The channel column: narrower in a small window, a little wider in a large one. */
export function channelColumnWidth(timelineWidth: number): number {
  if (timelineWidth < 1000) return 156
  if (timelineWidth >= 1800) return 240
  return 208
}

export function floorTo(ts: number, step: number): number {
  return Math.floor(ts / step) * step
}

export function ceilTo(ts: number, step: number): number {
  return Math.ceil(ts / step) * step
}

/** Where the timeline opens and where "Şimdi" goes back to: the half hour before now's half hour. */
export function defaultViewStart(now: number): number {
  return floorTo(now - HALF_HOUR_MS, HALF_HOUR_MS)
}

/**
 * The stretch of time the timeline spans: whole hours from the earliest to
 * the latest programme of the rows, kept within six hours back and two days
 * ahead of now, always including the time around now, and at least
 * `minSpanMs` long so a short guide still fills the window.
 */
export function timelineRange(
  rows: ReadonlyArray<{ programs: readonly EPGProgram[] }>,
  now: number,
  minSpanMs = 0
): { start: number; end: number } {
  let first = Infinity
  let last = -Infinity
  for (const row of rows) {
    const programs = row.programs
    if (programs.length === 0) continue
    first = Math.min(first, programs[0]!.start)
    last = Math.max(last, programs[programs.length - 1]!.end)
  }
  const earliest = now - MAX_PAST_MS
  const latest = now + MAX_FUTURE_MS
  const start = floorTo(Math.min(defaultViewStart(now), Math.max(earliest, Number.isFinite(first) ? first : now)), HOUR_MS)
  let end = ceilTo(Math.max(now + HOUR_MS, Math.min(latest, Number.isFinite(last) ? last : now)), HOUR_MS)
  if (end - start < minSpanMs) end = ceilTo(start + minSpanMs, HOUR_MS)
  return { start, end }
}

/**
 * The time window to draw, from the visible one: snapped to half hours and
 * widened by an hour on each side, so it changes (and rows draw again) only
 * every half hour of scrolling.
 */
export function drawWindow(visibleStart: number, visibleEnd: number): { from: number; to: number } {
  return {
    from: floorTo(visibleStart, HALF_HOUR_MS) - WINDOW_OVERSCAN_MS,
    to: ceilTo(visibleEnd, HALF_HOUR_MS) + WINDOW_OVERSCAN_MS
  }
}

/** Horizontal position of a moment on the timeline, in px from the range start. */
export function timeToX(ts: number, rangeStart: number): number {
  return ((ts - rangeStart) / MINUTE_MS) * PX_PER_MINUTE
}

/** The moment at a horizontal position on the timeline. */
export function xToTime(x: number, rangeStart: number): number {
  return rangeStart + (x / PX_PER_MINUTE) * MINUTE_MS
}

/** Index of the first programme that ends after `ts` (programmes.length when none does). */
export function firstEndingAfter(programs: readonly EPGProgram[], ts: number): number {
  let low = 0
  let high = programs.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (programs[mid]!.end > ts) high = mid
    else low = mid + 1
  }
  return low
}

export type GuideSegment =
  | { kind: 'program'; index: number; program: EPGProgram }
  | { kind: 'gap'; start: number; end: number }

/**
 * The programmes of a row that overlap the drawn window, and the stretches
 * without guide data between them that are long enough to label. Stretches
 * are measured whole, so a long one is labelled even when the window shows
 * only part of it; programmes and stretches are clipped to the range.
 */
export function segmentsInWindow(
  programs: readonly EPGProgram[],
  window: { from: number; to: number },
  range: { start: number; end: number }
): GuideSegment[] {
  const from = Math.max(window.from, range.start)
  const to = Math.min(window.to, range.end)
  const out: GuideSegment[] = []
  if (from >= to) return out

  const gap = (start: number, end: number) => {
    if (end - start >= GAP_LABEL_MIN_MS && end > from && start < to) out.push({ kind: 'gap', start, end })
  }

  let index = firstEndingAfter(programs, from)
  let covered = index > 0 ? Math.max(range.start, programs[index - 1]!.end) : range.start
  for (; index < programs.length; index++) {
    const program = programs[index]!
    if (program.start >= to) {
      gap(covered, Math.min(program.start, range.end))
      return out
    }
    if (program.end <= program.start) continue
    if (program.start > covered) gap(covered, program.start)
    out.push({ kind: 'program', index, program })
    covered = Math.max(covered, program.end)
  }
  gap(covered, range.end)
  return out
}

function overlapsRange(program: EPGProgram, range: { start: number; end: number }): boolean {
  return program.end > range.start && program.start < range.end && program.end > program.start
}

/** The programme left (-1) or right (+1) of `index` on the same row, or -1 at the end of the range. */
export function neighbourIndex(
  programs: readonly EPGProgram[],
  index: number,
  direction: -1 | 1,
  range: { start: number; end: number }
): number {
  for (let next = index + direction; next >= 0 && next < programs.length; next += direction) {
    const program = programs[next]!
    if (program.end <= program.start) continue
    return overlapsRange(program, range) ? next : -1
  }
  return -1
}

/**
 * The programme of a row on at `ts`, or the nearest one inside the range when
 * nothing is (an empty stretch): -1 only for a row with nothing in the range.
 */
export function indexAtTime(programs: readonly EPGProgram[], ts: number, range: { start: number; end: number }): number {
  const after = firstEndingAfter(programs, ts)
  let forward = -1
  for (let index = after; index < programs.length; index++) {
    if (programs[index]!.start >= range.end) break
    if (overlapsRange(programs[index]!, range)) {
      forward = index
      break
    }
  }
  if (forward !== -1 && programs[forward]!.start <= ts) return forward

  let backward = -1
  for (let index = after - 1; index >= 0; index--) {
    if (overlapsRange(programs[index]!, range)) {
      backward = index
      break
    }
    if (programs[index]!.end <= range.start) break
  }
  if (forward === -1) return backward
  if (backward === -1) return forward
  return programs[forward]!.start - ts <= ts - programs[backward]!.end ? forward : backward
}

/** Index of the programme that starts at `start`, or -1. */
export function indexByStart(programs: readonly EPGProgram[], start: number): number {
  let low = 0
  let high = programs.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const value = programs[mid]!.start
    if (value === start) return mid
    if (value < start) low = mid + 1
    else high = mid - 1
  }
  return -1
}

/** Calendar days from `now`'s day to `ts`'s day, in local time: 0 today, 1 tomorrow, -1 yesterday. */
export function calendarDayOffset(ts: number, now: number): number {
  const day = new Date(ts)
  day.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((day.getTime() - today.getTime()) / (24 * HOUR_MS))
}

export type ProgramTiming = 'live' | 'upcoming' | 'ended'

export function programTiming(program: EPGProgram, now: number): ProgramTiming {
  if (now < program.start) return 'upcoming'
  if (now >= program.end) return 'ended'
  return 'live'
}

/** How much of a programme has gone, 0–100. */
export function programProgress(program: EPGProgram, now: number): number {
  const length = program.end - program.start
  if (length <= 0) return 0
  return Math.min(100, Math.max(0, ((now - program.start) / length) * 100))
}

/**
 * The scroll position that brings the timeline stretch [left, right) into a
 * view `viewWidth` wide that starts at `scrollLeft`, or null when enough of it
 * is in view already. A block wider than the view shows its part nearest the
 * view rather than jumping to its start.
 */
export function revealScrollLeft(left: number, right: number, scrollLeft: number, viewWidth: number): number | null {
  const margin = 24
  const width = right - left
  const overlap = Math.min(right, scrollLeft + viewWidth) - Math.max(left, scrollLeft)
  if (overlap >= Math.min(width, 160)) return null
  const fits = width <= viewWidth - 2 * margin
  if (left >= scrollLeft) return Math.max(0, fits ? right + margin - viewWidth : left - margin)
  return Math.max(0, fits ? left - margin : right - viewWidth + margin)
}

/** The scroll position that brings row `index` fully below the sticky header, or null when it is. */
export function revealScrollTop(index: number, scrollTop: number, viewHeight: number): number | null {
  const top = HEADER_HEIGHT + index * ROW_PITCH
  if (top - HEADER_HEIGHT < scrollTop) return top - HEADER_HEIGHT
  if (top + ROW_PITCH > scrollTop + viewHeight) return top + ROW_PITCH - viewHeight
  return null
}
