import { defined } from '../../../shared/checked'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORE_NAME, storePersistence, useStore } from '@/store'
import { findProgress } from '@/services/watch-progress'
import { targetFromChannel } from '@/services/playback'
import type { Channel } from '@/types/playlist'
import { mediaKey } from '../../../shared/playback'
import { useWatchProgress } from './useWatchProgress'

const movie: Channel = {
  id: 'vod-1',
  name: 'Film',
  streamUrl: 'https://example.com/films/1.mp4',
  sourceId: 'src',
  type: 'vod'
}
const movieKey = mediaKey(targetFromChannel(movie)!)

function savedPosition(): number | null {
  return findProgress(useStore.getState().watchProgress, movieKey)?.position ?? null
}

describe('useWatchProgress', () => {
  const disk = new Map<string, string>()

  beforeEach(() => {
    vi.useFakeTimers()
    disk.clear()
    storePersistence.setBackend(
      {
        getItem: (name) => disk.get(name) ?? null,
        setItem: (name, value) => void disk.set(name, value),
        removeItem: (name) => void disk.delete(name)
      },
      { getItem: (name) => disk.get(name) ?? null, setItem: (name, value) => void disk.set(name, value) }
    )
    useStore.getState().stopPlayback()
    useStore.setState({ watchProgress: [] })
    storePersistence.flush()
  })

  afterEach(() => {
    // Without vitest globals, testing-library cannot register its own cleanup.
    cleanup()
    window.dispatchEvent(new Event('pageshow'))
    vi.useRealTimers()
  })

  it('writes the last position to storage when the window is closed', () => {
    renderHook(() => useWatchProgress())
    act(() => {
      useStore.getState().playChannel(movie)
      useStore.getState().applyPlayerPatch({ currentTime: 600, duration: 3600 })
    })

    window.dispatchEvent(new Event('pagehide'))

    expect(savedPosition()).toBe(600)
    // Not just in memory: the coalesced write must not be left pending.
    const stored = JSON.parse(disk.get(STORE_NAME) ?? '{}') as {
      state?: { watchProgress?: Array<{ key: string; position: number }> }
    }
    expect(stored.state?.watchProgress?.[0]).toMatchObject({ key: movieKey, position: 600 })
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
    useStore.getState().saveWatchProgress({ target: targetFromChannel(movie)!, channel: movie }, 1800, 3600)
    renderHook(() => useWatchProgress())

    // Back from the mini card: the film is loaded again from 0:00 and has not
    // been put back at 30:00 yet.
    act(() => {
      useStore.getState().playChannel(movie)
      useStore.getState().suspendPlayback()
      useStore.getState().resumeSuspendedPlayback()
    })
    expect(useStore.getState().pendingResume?.mediaKey).toBe(movieKey)
    act(() => useStore.getState().applyPlayerPatch({ currentTime: 45, duration: 3600 }))

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(savedPosition()).toBe(1800)

    // Once the resume has run, progress is recorded normally again.
    act(() => {
      useStore.getState().completeResume(defined(useStore.getState().pendingResume, 'the armed resume').playbackId)
      useStore.getState().applyPlayerPatch({ currentTime: 1830 })
      vi.advanceTimersByTime(10_000)
    })
    expect(savedPosition()).toBe(1830)
  })
})
