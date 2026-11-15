// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MpvLoadTracker } from './load-tracker'

const end = (entryId: number | null, reason: string, extra: { fileError?: string; insertId?: number } = {}) =>
  ({
    kind: 'end',
    entryId,
    reason,
    fileError: extra.fileError ?? null,
    insertId: extra.insertId ?? null
  }) as const

describe('MpvLoadTracker', () => {
  it('attributes events by the entry id the loadfile reply returned', () => {
    const tracker = new MpvLoadTracker()
    tracker.begin(7)
    expect(tracker.replied(7, 12)).toEqual([])

    // The previous file ending is not ours.
    expect(tracker.handle(end(11, 'stop'))).toEqual([])
    expect(tracker.accepting).toBe(false)

    expect(tracker.handle({ kind: 'start', entryId: 12 })).toEqual([
      { kind: 'start', entryId: 12, token: 7 }
    ])
    expect(tracker.accepting).toBe(true)
    expect(tracker.handle({ kind: 'loaded' })).toEqual([{ kind: 'loaded', token: 7 }])
    expect(tracker.handle(end(12, 'error', { fileError: 'loading failed' }))).toEqual([
      { ...end(12, 'error', { fileError: 'loading failed' }), token: 7 }
    ])
    expect(tracker.accepting).toBe(false)
  })

  it('replays events that arrived before the reply once the entry is known', () => {
    const tracker = new MpvLoadTracker()
    tracker.begin(1)
    expect(tracker.handle({ kind: 'start', entryId: 4 })).toEqual([])
    expect(tracker.handle(end(4, 'error', { fileError: 'loading failed' }))).toEqual([])

    const verdicts = tracker.replied(1, 4)
    expect(verdicts.map((verdict) => verdict.kind)).toEqual(['start', 'end'])
    expect(verdicts.every((verdict) => verdict.token === 1)).toBe(true)
  })

  it('falls back to the first start-file after the reply when mpv returns no id', () => {
    const tracker = new MpvLoadTracker()
    tracker.begin(1)
    tracker.replied(1, null)
    expect(tracker.handle({ kind: 'start', entryId: 9 })).toHaveLength(1)
    expect(tracker.handle(end(8, 'stop'))).toEqual([])
    expect(tracker.handle(end(9, 'eof'))).toHaveLength(1)
  })

  it('without a reply id, never adopts a file that started before the reply', () => {
    const tracker = new MpvLoadTracker()
    tracker.begin(1)
    tracker.handle({ kind: 'start', entryId: 5 })
    expect(tracker.replied(1, null)).toEqual([])
    expect(tracker.accepting).toBe(false)
    expect(tracker.handle({ kind: 'start', entryId: 6 })).toHaveLength(1)
  })

  it('follows a playlist redirect to the inserted entry', () => {
    const tracker = new MpvLoadTracker()
    tracker.begin(1)
    tracker.replied(1, 2)
    tracker.handle({ kind: 'start', entryId: 2 })
    expect(tracker.handle(end(2, 'redirect', { insertId: 3 }))).toHaveLength(1)
    expect(tracker.handle({ kind: 'start', entryId: 3 })).toHaveLength(1)
    expect(tracker.accepting).toBe(true)
  })

  it('drops everything after a new load begins or the load is cleared', () => {
    const tracker = new MpvLoadTracker()
    tracker.begin(1)
    tracker.replied(1, 1)
    tracker.handle({ kind: 'start', entryId: 1 })

    tracker.begin(2)
    expect(tracker.accepting).toBe(false)
    expect(tracker.handle({ kind: 'loaded' })).toEqual([])
    tracker.replied(2, 2)
    expect(tracker.handle(end(1, 'stop'))).toEqual([])

    tracker.clear()
    expect(tracker.token).toBeNull()
    expect(tracker.handle({ kind: 'start', entryId: 2 })).toEqual([])
  })
})
