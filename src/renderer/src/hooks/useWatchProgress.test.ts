import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import { findProgress } from '@/services/watch-progress'
import type { Channel } from '@/types/playlist'
import { useWatchProgress } from './useWatchProgress'

const movie: Channel = {
  id: 'vod-1',
  name: 'Film',
  streamUrl: 'https://example.com/films/1.mp4',
  sourceId: 'src',
  type: 'vod'
}

function savedPosition(): number | null {
  return findProgress(useStore.getState().watchProgress, movie)?.position ?? null
}

describe('useWatchProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.getState().stopPlayback()
    useStore.setState({ watchProgress: [] })
  })

  afterEach(() => {
    // Without vitest globals, testing-library cannot register its own cleanup.
    cleanup()
    vi.useRealTimers()
  })

  it('writes the last position when the window is closed', () => {
    renderHook(() => useWatchProgress())
    act(() => {
      useStore.getState().playChannel(movie)
      useStore.getState().applyPlayerPatch({ currentTime: 600, duration: 3600 })
    })

    window.dispatchEvent(new Event('pagehide'))

    expect(savedPosition()).toBe(600)
  })

  it('writes the position at once when the player is left for the mini card', () => {
    renderHook(() => useWatchProgress())
    act(() => {
      useStore.getState().playChannel(movie)
      useStore.getState().applyPlayerPatch({ currentTime: 900, duration: 3600 })
    })

    act(() => useStore.getState().suspendPlayback())

    expect(savedPosition()).toBe(900)
  })

  it('never lowers the saved position while the resume for that film is pending', () => {
    useStore.getState().saveWatchProgress(movie, 1800, 3600)
    renderHook(() => useWatchProgress())

    // Back from the mini card: the film is loaded again from 0:00 and has not
    // been put back at 30:00 yet.
    act(() => {
      useStore.getState().playChannel(movie)
      useStore.getState().suspendPlayback()
      useStore.getState().resumeSuspendedPlayback()
    })
    expect(useStore.getState().pendingResumeStreamUrl).toBe(movie.streamUrl)
    act(() => useStore.getState().applyPlayerPatch({ currentTime: 45, duration: 3600 }))

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(savedPosition()).toBe(1800)

    // Once the resume has run, progress is recorded normally again.
    act(() => {
      useStore.getState().clearPendingResume()
      useStore.getState().applyPlayerPatch({ currentTime: 1830 })
      vi.advanceTimersByTime(10_000)
    })
    expect(savedPosition()).toBe(1830)
  })
})
