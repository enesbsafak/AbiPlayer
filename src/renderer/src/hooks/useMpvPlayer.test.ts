import { describe, expect, it } from 'vitest'
import type { MpvStateSnapshot } from '@/services/platform'
import { shouldKeepStartupOverlay } from './useMpvPlayer'

function createSnapshot(overrides: Partial<MpvStateSnapshot> = {}): MpvStateSnapshot {
  return {
    available: true,
    running: false,
    paused: true,
    buffering: false,
    timePos: 0,
    duration: 0,
    volume: 80,
    muted: false,
    vid: null,
    aid: null,
    sid: null,
    fullscreen: false,
    tracks: [],
    path: null,
    error: null,
    ...overrides
  }
}

describe('shouldKeepStartupOverlay', () => {
  it('keeps the overlay while mpv is still idle for the target stream', () => {
    const snapshot = createSnapshot()

    expect(
      shouldKeepStartupOverlay(snapshot, 'https://example.com/live.m3u8', 1_000, 2_000)
    ).toBe(true)
  })

  it('hides the overlay once track metadata arrives', () => {
    const snapshot = createSnapshot({
      path: 'https://example.com/live.m3u8',
      tracks: [
        {
          id: 1,
          type: 'audio',
          selected: true,
          external: false
        }
      ]
    })

    expect(
      shouldKeepStartupOverlay(snapshot, 'https://example.com/live.m3u8', 1_000, 2_000)
    ).toBe(false)
  })

  it('hides the overlay when buffering starts', () => {
    const snapshot = createSnapshot({
      path: 'https://example.com/live.m3u8',
      buffering: true
    })

    expect(
      shouldKeepStartupOverlay(snapshot, 'https://example.com/live.m3u8', 1_000, 2_000)
    ).toBe(false)
  })

  it('hides the overlay when mpv reports an error', () => {
    const snapshot = createSnapshot({
      error: 'network timeout'
    })

    expect(
      shouldKeepStartupOverlay(snapshot, 'https://example.com/live.m3u8', 1_000, 2_000)
    ).toBe(false)
  })

  it('hides the overlay after the startup timeout elapses', () => {
    const snapshot = createSnapshot()

    expect(
      shouldKeepStartupOverlay(snapshot, 'https://example.com/live.m3u8', 1_000, 17_000)
    ).toBe(false)
  })
})
