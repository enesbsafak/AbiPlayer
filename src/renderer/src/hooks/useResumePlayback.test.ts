import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return { ...actual, mpvSeekTo: vi.fn(() => Promise.resolve()) }
})

import { mpvSeekTo } from '@/services/platform'
import { useResumePlayback } from './useResumePlayback'

const movie: Channel = {
  id: 'vod-1',
  name: 'Film',
  streamUrl: 'https://example.com/films/1.mp4',
  sourceId: 'src',
  type: 'vod'
}

function fakeVideoRef() {
  return { current: { currentTime: 0 } as unknown as HTMLVideoElement }
}

/** Played, resumed once, then left for the mini card. */
function leaveFilmForMiniCard() {
  useStore.getState().saveWatchProgress(movie, 1800, 3600)
  useStore.getState().playChannel(movie)
  useStore.getState().clearPendingResume()
  useStore.getState().suspendPlayback()
}

describe('useResumePlayback', () => {
  beforeEach(() => {
    useStore.getState().stopPlayback()
    useStore.setState({ watchProgress: [] })
  })

  // Without vitest globals, testing-library cannot register its own cleanup,
  // and a hook left mounted would keep reacting to the shared store.
  afterEach(cleanup)

  it('puts a film back at its saved position when the mini card is expanded (html5)', () => {
    leaveFilmForMiniCard()
    const videoRef = fakeVideoRef()

    // Expanding mounts the player again; the engine reloads the file.
    useStore.getState().resumeSuspendedPlayback()
    const { result } = renderHook(() => useResumePlayback(videoRef, false, true))
    expect(videoRef.current.currentTime).toBe(0)

    act(() => useStore.getState().applyPlayerPatch({ duration: 3600 }))

    expect(videoRef.current.currentTime).toBe(1795)
    expect(result.current.resumedFrom).toBe(1795)
    expect(useStore.getState().pendingResumeStreamUrl).toBeNull()
  })

  it('seeks mpv the same way', () => {
    leaveFilmForMiniCard()
    useStore.getState().resumeSuspendedPlayback()
    renderHook(() => useResumePlayback(fakeVideoRef(), true, true))

    act(() => useStore.getState().applyPlayerPatch({ duration: 3600 }))

    expect(vi.mocked(mpvSeekTo)).toHaveBeenCalledWith(1795)
  })

  it('does not seek on the stale duration left over from before the suspend', () => {
    useStore.getState().saveWatchProgress(movie, 1800, 3600)
    useStore.getState().playChannel(movie)
    useStore.getState().clearPendingResume()
    useStore.getState().applyPlayerPatch({ duration: 3600, currentTime: 2000 })
    useStore.getState().suspendPlayback()
    useStore.getState().resumeSuspendedPlayback()
    const videoRef = fakeVideoRef()

    renderHook(() => useResumePlayback(videoRef, false, true))

    // Nothing is loaded yet, so there is nothing to seek.
    expect(videoRef.current.currentTime).toBe(0)
    expect(useStore.getState().pendingResumeStreamUrl).toBe(movie.streamUrl)
  })
})
