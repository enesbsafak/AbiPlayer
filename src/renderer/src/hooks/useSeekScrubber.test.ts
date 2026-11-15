import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSeekScrubber } from './useSeekScrubber'

describe('useSeekScrubber', () => {
  afterEach(cleanup)

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
    act(() => result.current.commit())
    expect(onSeek).not.toHaveBeenCalled()
  })
})
