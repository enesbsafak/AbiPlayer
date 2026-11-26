import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SEEK_PENDING_TIMEOUT_MS, useSeekScrubber } from './useSeekScrubber'

describe('useSeekScrubber', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('follows the playback position while idle', () => {
    const onSeek = vi.fn()
    const { result, rerender } = renderHook(({ time }) => useSeekScrubber(time, onSeek), {
      initialProps: { time: 10 }
    })
    expect(result.current.value).toBe(10)
    rerender({ time: 11 })
    expect(result.current.value).toBe(11)
  })

  it('holds the dragged value against time updates and seeks once on release', () => {
    const onSeek = vi.fn()
    const { result, rerender } = renderHook(({ time }) => useSeekScrubber(time, onSeek), {
      initialProps: { time: 100 }
    })

    act(() => result.current.hold())
    act(() => result.current.update(400))
    act(() => result.current.update(800))
    // Playback keeps reporting the old position while the thumb is held.
    rerender({ time: 101 })
    expect(result.current.value).toBe(800)
    expect(result.current.isScrubbing).toBe(true)
    expect(onSeek).not.toHaveBeenCalled()

    act(() => result.current.commit())
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(800)
    expect(result.current.isScrubbing).toBe(false)

    // Repeated release events (pointerup, then blur) do not seek again.
    act(() => result.current.commit())
    expect(onSeek).toHaveBeenCalledTimes(1)
  })

  it('ignores a release without a drag', () => {
    const onSeek = vi.fn()
    const { result } = renderHook(() => useSeekScrubber(5, onSeek))
    act(() => result.current.hold())
    act(() => result.current.commit())
    expect(onSeek).not.toHaveBeenCalled()
  })

  it("ignores the browser's late change event after the release", () => {
    const onSeek = vi.fn()
    const { result, rerender } = renderHook(({ time }) => useSeekScrubber(time, onSeek), {
      initialProps: { time: 10.4 }
    })
    act(() => result.current.hold())
    act(() => result.current.update(1800))
    act(() => result.current.commit())
    // The mouse button goes up after the pointer: `change` with the bar's
    // value as the release left it, the old position.
    act(() => result.current.update(10))
    expect(result.current.isScrubbing).toBe(false)

    // The engine arrives; nothing holds the bar on the old position, and a
    // later blur does not seek back to it.
    rerender({ time: 1800.2 })
    expect(result.current.value).toBe(1800.2)
    act(() => result.current.commit())
    expect(onSeek).toHaveBeenCalledTimes(1)
  })

  it('stays on the target until the engine reports it, or gives up waiting', () => {
    vi.useFakeTimers()
    const onSeek = vi.fn()
    const { result, rerender } = renderHook(({ time }) => useSeekScrubber(time, onSeek), {
      initialProps: { time: 10 }
    })
    act(() => result.current.hold())
    act(() => result.current.update(1800))
    act(() => result.current.commit())

    // Still buffering at the old position: the bar does not jump back.
    rerender({ time: 10.5 })
    expect(result.current.value).toBe(1800)
    rerender({ time: 1799 })
    expect(result.current.value).toBe(1799)
    rerender({ time: 1830 })
    expect(result.current.value).toBe(1830)

    // A stream that cannot seek never reports the target.
    act(() => result.current.hold())
    act(() => result.current.update(600))
    act(() => result.current.commit())
    rerender({ time: 1831 })
    expect(result.current.value).toBe(600)
    act(() => {
      vi.advanceTimersByTime(SEEK_PENDING_TIMEOUT_MS)
    })
    expect(result.current.value).toBe(1831)
  })
})
