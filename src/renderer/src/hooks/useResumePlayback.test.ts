import { defined } from '../../../shared/checked'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'
import type { CurrentPlayback } from '@/types/player'

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return { ...actual, mpvSeekTo: vi.fn(() => Promise.resolve()) }
})

import { mpvSeekTo } from '@/services/platform'
import { planResume, resumeSeekVerdict, useResumePlayback } from './useResumePlayback'
import { targetFromChannel } from '@/services/playback'

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

function saveMovieAt(position: number) {
  useStore.getState().saveWatchProgress({ target: targetFromChannel(movie)!, channel: movie }, position, 3600)
}

function currentPlaybackId(): string {
  return useStore.getState().currentPlayback!.playbackId
}

/** Played, resumed once, then left for the mini card. */
function leaveFilmForMiniCard() {
  saveMovieAt(1800)
  useStore.getState().playChannel(movie)
  useStore.getState().completeResume(defined(useStore.getState().pendingResume, 'the armed resume').playbackId)
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

    act(() => useStore.getState().markPlaybackLoaded(currentPlaybackId()))

    expect(videoRef.current.currentTime).toBe(1795)
    expect(result.current.resumedFrom).toBe(1795)
    expect(useStore.getState().pendingResume).toBeNull()
  })

  it('seeks mpv the same way, and finishes once its snapshots show the new position', async () => {
    let acknowledge: () => void = () => undefined
    vi.mocked(mpvSeekTo).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        acknowledge = resolve
      })
    )
    leaveFilmForMiniCard()
    useStore.getState().resumeSuspendedPlayback()
    renderHook(() => useResumePlayback(fakeVideoRef(), true, true))

    act(() => useStore.getState().markPlaybackLoaded(currentPlaybackId()))

    expect(vi.mocked(mpvSeekTo)).toHaveBeenCalledWith(1795)
    expect(useStore.getState().pendingResume).toMatchObject({ phase: 'seek-issued', position: 1795 })

    // The command was accepted, but the position has not moved yet.
    await act(async () => acknowledge())
    act(() => useStore.getState().applyPlayerPatch({ currentTime: 0.4 }))
    expect(useStore.getState().pendingResume?.phase).toBe('seek-issued')

    act(() => useStore.getState().applyPlayerPatch({ currentTime: 1795.2 }))
    expect(useStore.getState().pendingResume).toBeNull()
  })

  it('stops waiting when mpv rejects the seek', async () => {
    vi.mocked(mpvSeekTo).mockReturnValueOnce(Promise.reject(new Error('not seekable')))
    leaveFilmForMiniCard()
    useStore.getState().resumeSuspendedPlayback()
    renderHook(() => useResumePlayback(fakeVideoRef(), true, true))

    await act(async () => useStore.getState().markPlaybackLoaded(currentPlaybackId()))
    expect(useStore.getState().pendingResume).toBeNull()
  })

  it('stops waiting when an accepted seek never lands and the film plays on from the start', async () => {
    leaveFilmForMiniCard()
    useStore.getState().resumeSuspendedPlayback()
    renderHook(() => useResumePlayback(fakeVideoRef(), true, true))
    await act(async () => useStore.getState().markPlaybackLoaded(currentPlaybackId()))

    act(() => useStore.getState().applyPlayerPatch({ currentTime: 5 }))
    expect(useStore.getState().pendingResume?.phase).toBe('seek-issued')
    act(() => useStore.getState().applyPlayerPatch({ currentTime: 11 }))
    expect(useStore.getState().pendingResume).toBeNull()
  })

  it('a position reported for another playback does not finish the resume', async () => {
    leaveFilmForMiniCard()
    useStore.getState().resumeSuspendedPlayback()
    renderHook(() => useResumePlayback(fakeVideoRef(), true, true))
    await act(async () => useStore.getState().markPlaybackLoaded(currentPlaybackId()))
    const issuedFor = currentPlaybackId()

    // The viewer reloads before the seek lands; the reload owes its own resume.
    act(() => useStore.getState().reloadPlayback())
    act(() => useStore.getState().applyPlayerPatch({ currentTime: 1795 }))

    expect(useStore.getState().pendingResume).toMatchObject({ phase: 'awaiting-load' })
    expect(useStore.getState().pendingResume?.playbackId).not.toBe(issuedFor)
  })

  it('does not seek, nor give up, merely because a duration appeared', () => {
    saveMovieAt(1800)
    useStore.getState().playChannel(movie)
    const videoRef = fakeVideoRef()
    renderHook(() => useResumePlayback(videoRef, false, true))

    // A duration (here: left over from an earlier load) is not the engine
    // reporting this playback as loaded.
    act(() => useStore.getState().applyPlayerPatch({ duration: 3600, currentTime: 2000 }))

    expect(videoRef.current.currentTime).toBe(0)
    expect(useStore.getState().pendingResume?.phase).toBe('awaiting-load')
  })

  it('ignores a load report for an earlier attempt of the same film', () => {
    saveMovieAt(1800)
    useStore.getState().playChannel(movie)
    const earlier = currentPlaybackId()
    useStore.getState().reloadPlayback()
    const videoRef = fakeVideoRef()
    renderHook(() => useResumePlayback(videoRef, false, true))

    act(() => useStore.getState().markPlaybackLoaded(earlier))

    expect(videoRef.current.currentTime).toBe(0)
    expect(useStore.getState().pendingResume?.playbackId).toBe(currentPlaybackId())
  })

  it('clears the flag when there is nothing to go back to', () => {
    useStore.getState().playChannel(movie)
    const videoRef = fakeVideoRef()
    const { result } = renderHook(() => useResumePlayback(videoRef, false, true))

    act(() => useStore.getState().markPlaybackLoaded(currentPlaybackId()))

    expect(useStore.getState().pendingResume).toBeNull()
    expect(result.current.resumedFrom).toBeNull()
  })
})

describe('planResume', () => {
  const playback: CurrentPlayback = {
    playbackId: 'p2',
    target: { kind: 'm3u', sourceId: 'src', entryId: 'abcdef12', mediaType: 'vod' },
    mediaKey: 'k',
    streamUrl: movie.streamUrl
  }
  const pending = { playbackId: 'p2', mediaKey: 'k', phase: 'awaiting-load' as const, position: null }

  it('waits for the engine, the matching playback and its load', () => {
    const base = { pending, playback, loadedPlaybackId: 'p2', isEngineResolved: true, savedPosition: 100 }
    expect(planResume({ ...base, isEngineResolved: false })).toEqual({ kind: 'wait' })
    expect(planResume({ ...base, loadedPlaybackId: 'p1' })).toEqual({ kind: 'wait' })
    expect(planResume({ ...base, playback: { ...playback, playbackId: 'p3' } })).toEqual({ kind: 'wait' })
    expect(planResume({ ...base, pending: { ...pending, phase: 'seek-issued', position: 100 } })).toEqual({
      kind: 'wait'
    })
    expect(planResume(base)).toEqual({ kind: 'seek', playbackId: 'p2', position: 100 })
  })
})

describe('resumeSeekVerdict', () => {
  it('lands near the target, waits before it, and gives up once playback ran on without it', () => {
    expect(resumeSeekVerdict({ position: 600, currentTime: 601.5, acknowledgedAt: null })).toBe('landed')
    expect(resumeSeekVerdict({ position: 600, currentTime: 0.2, acknowledgedAt: null })).toBe('waiting')
    expect(resumeSeekVerdict({ position: 600, currentTime: 8, acknowledgedAt: 0.2 })).toBe('waiting')
    expect(resumeSeekVerdict({ position: 600, currentTime: 10.5, acknowledgedAt: 0.2 })).toBe('gave-up')
    // Without an acknowledgement nothing is given up on.
    expect(resumeSeekVerdict({ position: 600, currentTime: 50, acknowledgedAt: null })).toBe('waiting')
  })
})
