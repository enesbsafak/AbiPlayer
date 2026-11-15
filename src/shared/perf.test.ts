import { describe, expect, it } from 'vitest'
import {
  createMpvProgressProbe,
  createPerfRecorder,
  describeXtreamUrl,
  findMark,
  isPerfFlag,
  mergeTimelines,
  summarizeMarks
} from './perf'

function clock(start = 0) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('isPerfFlag', () => {
  it('accepts the usual truthy spellings and nothing else', () => {
    expect(isPerfFlag('1')).toBe(true)
    expect(isPerfFlag(' TRUE ')).toBe(true)
    expect(isPerfFlag('on')).toBe(true)
    expect(isPerfFlag('0')).toBe(false)
    expect(isPerfFlag('')).toBe(false)
    expect(isPerfFlag(undefined)).toBe(false)
    expect(isPerfFlag(null)).toBe(false)
  })
})

describe('createPerfRecorder', () => {
  it('records nothing while disabled', () => {
    const recorder = createPerfRecorder({ process: 'main', enabled: false, now: () => 5, timeOrigin: 1000 })
    recorder.mark('a')
    recorder.longTask(1, 60)

    const timeline = recorder.timeline()
    expect(timeline.enabled).toBe(false)
    expect(timeline.marks).toEqual([])
    expect(timeline.longTasks).toEqual([])
  })

  it('records marks with their time and a copy of the detail', () => {
    const time = clock(10)
    const recorder = createPerfRecorder({ process: 'renderer', enabled: true, now: time.now, timeOrigin: 1000 })
    const detail = { action: 'get_live_streams' }
    recorder.mark('first')
    time.advance(2.345)
    recorder.mark('second', detail)
    detail.action = 'mutated'

    const timeline = recorder.timeline()
    expect(timeline).toMatchObject({ version: 1, process: 'renderer', enabled: true, timeOrigin: 1000, dropped: 0 })
    expect(timeline.marks).toEqual([
      { name: 'first', t: 10 },
      { name: 'second', t: 12.35, detail: { action: 'get_live_streams' } }
    ])
  })

  it('returns a snapshot that later marks do not change', () => {
    const recorder = createPerfRecorder({ process: 'main', enabled: true, now: () => 1, timeOrigin: 0 })
    recorder.mark('a')
    const snapshot = recorder.timeline()
    recorder.mark('b')
    expect(snapshot.marks).toHaveLength(1)
  })

  it('caps the buffer and counts what it refused', () => {
    const recorder = createPerfRecorder({ process: 'main', enabled: true, now: () => 1, timeOrigin: 0, maxEntries: 2 })
    recorder.mark('a')
    recorder.mark('b')
    recorder.mark('c')
    recorder.longTask(0, 51)
    recorder.longTask(1, 52)
    recorder.longTask(2, 53)

    const timeline = recorder.timeline()
    expect(timeline.marks.map((mark) => mark.name)).toEqual(['a', 'b'])
    expect(timeline.longTasks).toHaveLength(2)
    expect(timeline.dropped).toBe(2)
  })

  it('reset clears marks, long tasks and the dropped count', () => {
    const recorder = createPerfRecorder({ process: 'main', enabled: true, now: () => 1, timeOrigin: 0, maxEntries: 1 })
    recorder.mark('a')
    recorder.mark('b')
    recorder.longTask(0, 80)
    recorder.reset()
    expect(recorder.timeline()).toMatchObject({ marks: [], longTasks: [], dropped: 0 })
  })
})

describe('summarizeMarks', () => {
  it('orders by time and reports the gap to the previous mark', () => {
    expect(
      summarizeMarks([
        { name: 'late', t: 30 },
        { name: 'early', t: 10 },
        { name: 'middle', t: 12.5 }
      ])
    ).toEqual([
      { name: 'early', t: 10, sincePrevious: 10 },
      { name: 'middle', t: 12.5, sincePrevious: 2.5 },
      { name: 'late', t: 30, sincePrevious: 17.5 }
    ])
  })
})

describe('mergeTimelines', () => {
  it('rebases every process onto the earliest origin', () => {
    const main = createPerfRecorder({ process: 'main', enabled: true, now: () => 100, timeOrigin: 1_000 })
    const renderer = createPerfRecorder({ process: 'renderer', enabled: true, now: () => 5, timeOrigin: 1_400 })
    main.mark('main:ready')
    renderer.mark('renderer:entry')
    renderer.longTask(20, 75)

    const merged = mergeTimelines([renderer.timeline(), main.timeline()])
    expect(merged.timeOrigin).toBe(1_000)
    expect(merged.marks).toEqual([
      { name: 'main:ready', t: 100, process: 'main' },
      { name: 'renderer:entry', t: 405, process: 'renderer' }
    ])
    expect(merged.longTasks).toEqual([{ start: 420, duration: 75, process: 'renderer' }])
  })

  it('handles no input', () => {
    expect(mergeTimelines([])).toEqual({ version: 1, timeOrigin: 0, marks: [], longTasks: [], dropped: 0 })
  })
})

describe('findMark', () => {
  it('finds the first mark with the name at or after a time', () => {
    const marks = [
      { name: 'x', t: 1 },
      { name: 'y', t: 2 },
      { name: 'x', t: 3 }
    ]
    expect(findMark(marks, 'x')?.t).toBe(1)
    expect(findMark(marks, 'x', 2)?.t).toBe(3)
    expect(findMark(marks, 'z')).toBeNull()
  })
})

describe('describeXtreamUrl', () => {
  it('keeps the action and drops the credentials', () => {
    const detail = describeXtreamUrl(
      'http://panel.example:8080/player_api.php?username=alice&password=s3cret&action=get_vod_streams&category_id=7'
    )
    expect(detail).toEqual({ action: 'get_vod_streams', category: true })
    expect(JSON.stringify(detail)).not.toContain('alice')
    expect(JSON.stringify(detail)).not.toContain('s3cret')
  })

  it('names the authentication request and survives garbage', () => {
    expect(describeXtreamUrl('http://p/player_api.php?username=a&password=b')).toEqual({ action: 'auth', category: false })
    expect(describeXtreamUrl('not a url')).toEqual({ action: 'unknown', category: false })
  })
})

describe('createMpvProgressProbe', () => {
  it('ignores snapshots before begin and snapshots for another path', () => {
    const probe = createMpvProgressProbe()
    expect(probe.observe({ path: 'a', timePos: 3 })).toBe(false)
    probe.begin('b')
    expect(probe.observe({ path: 'a', timePos: 4 })).toBe(false)
    expect(probe.observe({ path: null, timePos: 5 })).toBe(false)
  })

  it('reports a cold start once the position starts moving', () => {
    const probe = createMpvProgressProbe()
    probe.begin('b')
    expect(probe.observe({ path: 'b', timePos: 0 })).toBe(false)
    expect(probe.observe({ path: 'b', timePos: 0 })).toBe(false)
    expect(probe.observe({ path: 'b', timePos: 0.2 })).toBe(true)
    expect(probe.observe({ path: 'b', timePos: 0.4 })).toBe(false)
  })

  it('does not mistake the previous stream position for progress on a warm switch', () => {
    const probe = createMpvProgressProbe()
    probe.begin('second')
    // The controller still reports the first channel's position under the new path.
    expect(probe.observe({ path: 'second', timePos: 42.5 })).toBe(false)
    expect(probe.observe({ path: 'second', timePos: 42.5 })).toBe(false)
    expect(probe.observe({ path: 'second', timePos: 0.3 })).toBe(true)
  })

  it('treats a non-finite position as zero', () => {
    const probe = createMpvProgressProbe()
    probe.begin('b')
    expect(probe.observe({ path: 'b', timePos: Number.NaN })).toBe(false)
    expect(probe.observe({ path: 'b', timePos: 1 })).toBe(true)
  })
})
