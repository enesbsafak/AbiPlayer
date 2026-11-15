/**
 * Timing marks for the startup chain and playback opening (plan item F0-07).
 *
 * Off by default. Main enables it with the `ABI_PERF=1` environment variable and
 * hands the flag to the renderer as the `abiPerf=1` query parameter; in dev the
 * renderer can also be switched on with `localStorage['abi:perf'] = '1'`.
 *
 * A disabled recorder does nothing but an early return, so the marks can stay in
 * production code. Times are milliseconds relative to the owning process's
 * `performance.timeOrigin` (process start in main, navigation start in the
 * renderer); `timeOrigin` travels with each timeline so they can be merged.
 */

export const PERF_ENV_VAR = 'ABI_PERF'
/** When set together with ABI_PERF, main writes its timeline here on quit. */
export const PERF_OUT_ENV_VAR = 'ABI_PERF_OUT'
export const PERF_QUERY_PARAM = 'abiPerf'
export const PERF_LOCAL_STORAGE_KEY = 'abi:perf'
/** Global the e2e driver reads through `evaluate()`, in both processes. */
export const PERF_GLOBAL_KEY = '__abiPerf'

export type PerfProcess = 'main' | 'renderer'
export type PerfDetail = Record<string, string | number | boolean | null>

export interface PerfMark {
  name: string
  /** Milliseconds since this process's timeOrigin. */
  t: number
  detail?: PerfDetail
}

export interface PerfLongTask {
  start: number
  duration: number
}

export interface PerfTimeline {
  version: 1
  process: PerfProcess
  enabled: boolean
  /** Epoch milliseconds that `t` values are relative to. */
  timeOrigin: number
  marks: PerfMark[]
  longTasks: PerfLongTask[]
  /** Entries refused because the buffer was full. */
  dropped: number
}

export interface PerfSummaryRow {
  name: string
  t: number
  sincePrevious: number
}

export interface PerfRecorder {
  readonly enabled: boolean
  mark(name: string, detail?: PerfDetail): void
  longTask(start: number, duration: number): void
  timeline(): PerfTimeline
  summary(): PerfSummaryRow[]
  reset(): void
}

export interface PerfRecorderOptions {
  process: PerfProcess
  enabled: boolean
  now: () => number
  timeOrigin: number
  /** Marks and long tasks are capped separately; a long session must not grow without bound. */
  maxEntries?: number
}

const DEFAULT_MAX_ENTRIES = 5000

export function isPerfFlag(value: string | null | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'on', 'yes'].includes(value.trim().toLowerCase())
}

/**
 * Where main writes its timeline on quit (`ABI_PERF_OUT`). Only development
 * builds honour it: a packaged app must not write to a path an environment
 * variable chose.
 */
export function perfOutputPath(value: string | undefined, isPackaged: boolean): string | null {
  if (isPackaged) return null
  return value?.trim() || null
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function createPerfRecorder(options: PerfRecorderOptions): PerfRecorder {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  let marks: PerfMark[] = []
  let longTasks: PerfLongTask[] = []
  let dropped = 0

  return {
    enabled: options.enabled,

    mark(name, detail) {
      if (!options.enabled) return
      if (marks.length >= maxEntries) {
        dropped += 1
        return
      }
      const entry: PerfMark = { name, t: round(options.now()) }
      if (detail) entry.detail = { ...detail }
      marks.push(entry)
    },

    longTask(start, duration) {
      if (!options.enabled) return
      if (longTasks.length >= maxEntries) {
        dropped += 1
        return
      }
      longTasks.push({ start: round(start), duration: round(duration) })
    },

    timeline() {
      return {
        version: 1,
        process: options.process,
        enabled: options.enabled,
        timeOrigin: options.timeOrigin,
        marks: marks.map((mark) => (mark.detail ? { ...mark, detail: { ...mark.detail } } : { ...mark })),
        longTasks: longTasks.map((task) => ({ ...task })),
        dropped
      }
    },

    summary() {
      return summarizeMarks(marks)
    },

    reset() {
      marks = []
      longTasks = []
      dropped = 0
    }
  }
}

export function summarizeMarks(marks: readonly PerfMark[]): PerfSummaryRow[] {
  const sorted = [...marks].sort((a, b) => a.t - b.t)
  let previous: PerfMark | undefined
  return sorted.map((mark) => {
    const sincePrevious = previous ? round(mark.t - previous.t) : mark.t
    previous = mark
    return { name: mark.name, t: mark.t, sincePrevious }
  })
}

export interface MergedPerfMark extends PerfMark {
  process: PerfProcess
}

export interface MergedPerfLongTask extends PerfLongTask {
  process: PerfProcess
}

export interface MergedPerfTimeline {
  version: 1
  /** Epoch milliseconds of the earliest input timeline; every `t` is relative to it. */
  timeOrigin: number
  marks: MergedPerfMark[]
  longTasks: MergedPerfLongTask[]
  dropped: number
}

/**
 * Puts timelines from different processes on one clock: the earliest
 * `timeOrigin` (normally main's process start) becomes zero.
 */
export function mergeTimelines(timelines: readonly PerfTimeline[]): MergedPerfTimeline {
  const origin = timelines.length > 0 ? Math.min(...timelines.map((timeline) => timeline.timeOrigin)) : 0
  const marks: MergedPerfMark[] = []
  const longTasks: MergedPerfLongTask[] = []
  let dropped = 0

  for (const timeline of timelines) {
    const offset = timeline.timeOrigin - origin
    dropped += timeline.dropped
    for (const mark of timeline.marks) {
      marks.push({ ...mark, t: round(mark.t + offset), process: timeline.process })
    }
    for (const task of timeline.longTasks) {
      longTasks.push({ ...task, start: round(task.start + offset), process: timeline.process })
    }
  }

  marks.sort((a, b) => a.t - b.t)
  longTasks.sort((a, b) => a.start - b.start)
  return { version: 1, timeOrigin: origin, marks, longTasks, dropped }
}

/**
 * Only the action and whether a category filter was present: the request URL
 * itself carries the account's username and password and must never be
 * recorded.
 */
export function describeXtreamUrl(url: string): PerfDetail {
  try {
    const parsed = new URL(url)
    return {
      action: parsed.searchParams.get('action') || 'auth',
      category: parsed.searchParams.has('category_id')
    }
  } catch {
    return { action: 'unknown', category: false }
  }
}

export interface MpvProgressProbe {
  /** Call right before `mpv-open`. */
  begin(url: string): void
  /**
   * Feed every `mpv-get-state` snapshot. Returns true exactly once per `begin`,
   * on the first snapshot that shows the new file advancing.
   */
  observe(snapshot: { path: string | null; timePos: number }): boolean
}

/**
 * Detects "the new stream is playing" from polled snapshots. A bare
 * `timePos > 0` is not enough: the controller keeps the previous file's
 * position until the new file reports one (plan item F1-04), so a warm switch
 * would read as instant. Instead the probe waits for the snapshot to carry the
 * new path, takes the position it shows then as a baseline, and reports the
 * first position that differs from it.
 */
export function createMpvProgressProbe(): MpvProgressProbe {
  let expectedUrl: string | null = null
  let baseline: number | null = null

  return {
    begin(url) {
      expectedUrl = url
      baseline = null
    },
    observe(snapshot) {
      if (expectedUrl === null || snapshot.path !== expectedUrl) return false
      const position = Number.isFinite(snapshot.timePos) ? snapshot.timePos : 0
      if (baseline === null) {
        baseline = position
        return false
      }
      if (position > 0 && position !== baseline) {
        expectedUrl = null
        baseline = null
        return true
      }
      return false
    }
  }
}
