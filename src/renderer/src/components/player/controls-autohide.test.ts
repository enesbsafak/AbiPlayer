import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTROLS_HIDE_DELAY_MS, ControlsAutoHide, POINTER_MOVE_THRESHOLD_PX } from './controls-autohide'

function setup() {
  const changes: boolean[] = []
  const autoHide = new ControlsAutoHide((visible) => changes.push(visible))
  return { autoHide, changes }
}

describe('ControlsAutoHide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the delay the hint promises (3 seconds)', () => {
    expect(CONTROLS_HIDE_DELAY_MS).toBe(3000)
  })

  it('shows on open and hides after the delay without the mouse ever moving', () => {
    const { autoHide, changes } = setup()
    autoHide.start()
    expect(changes).toEqual([true])

    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS - 1)
    expect(autoHide.visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(autoHide.visible).toBe(false)
    expect(changes).toEqual([true, false])
  })

  it('says shown on open even if it thinks it already is (the store may still say hidden)', () => {
    const { autoHide, changes } = setup()
    autoHide.start()
    autoHide.dispose()
    autoHide.start()
    expect(changes).toEqual([true, true])
  })

  it('ignores moves of a couple of pixels, hidden or shown', () => {
    const { autoHide } = setup()
    autoHide.start()
    autoHide.pointerMove(100, 100)
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS)
    expect(autoHide.visible).toBe(false)

    // Jitter around the resting point, and Chromium's zero-length moves.
    autoHide.pointerMove(102, 101)
    autoHide.pointerMove(99, 98)
    autoHide.pointerMove(100, 100)
    expect(autoHide.visible).toBe(false)

    autoHide.pointerMove(100 + POINTER_MOVE_THRESHOLD_PX, 100)
    expect(autoHide.visible).toBe(true)

    // Shown: jitter does not keep it up either.
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS - 500)
    autoHide.pointerMove(100 + POINTER_MOVE_THRESHOLD_PX + 1, 101)
    vi.advanceTimersByTime(500)
    expect(autoHide.visible).toBe(false)
  })

  it('does not count the first position it sees as a move', () => {
    const { autoHide } = setup()
    autoHide.start()
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS)
    autoHide.pointerMove(400, 300)
    expect(autoHide.visible).toBe(false)
  })

  it('counts the delay again from every real move', () => {
    const { autoHide } = setup()
    autoHide.start()
    autoHide.pointerMove(0, 0)
    vi.advanceTimersByTime(2000)
    autoHide.pointerMove(50, 0)
    vi.advanceTimersByTime(2000)
    expect(autoHide.visible).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(autoHide.visible).toBe(false)
  })

  it('shows on any other sign of use and hides after the delay', () => {
    const { autoHide } = setup()
    autoHide.start()
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS)
    autoHide.activity()
    expect(autoHide.visible).toBe(true)
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS)
    expect(autoHide.visible).toBe(false)
  })

  it.each(['pointer', 'menu', 'focus', 'sidebar', 'error'] as const)(
    'stays up while held (%s), and counts the delay from the release',
    (hold) => {
      const { autoHide } = setup()
      autoHide.start()
      vi.advanceTimersByTime(1000)
      autoHide.setHold(hold, true)
      vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS * 5)
      expect(autoHide.visible).toBe(true)

      autoHide.setHold(hold, false)
      vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS - 1)
      expect(autoHide.visible).toBe(true)
      vi.advanceTimersByTime(1)
      expect(autoHide.visible).toBe(false)
    }
  )

  it('shows a hidden panel when a hold starts (focus moving into it)', () => {
    const { autoHide } = setup()
    autoHide.start()
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS)
    autoHide.setHold('focus', true)
    expect(autoHide.visible).toBe(true)
  })

  it('waits for the last of several holds', () => {
    const { autoHide } = setup()
    autoHide.start()
    autoHide.setHold('menu', true)
    autoHide.setHold('pointer', true)
    autoHide.setHold('menu', false)
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS * 2)
    expect(autoHide.visible).toBe(true)
    autoHide.setHold('pointer', false)
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS)
    expect(autoHide.visible).toBe(false)
  })

  it('does not restart the delay for a hold that did not change', () => {
    const { autoHide } = setup()
    autoHide.start()
    vi.advanceTimersByTime(2000)
    autoHide.setHold('sidebar', false)
    vi.advanceTimersByTime(1000)
    expect(autoHide.visible).toBe(false)
  })

  it('a hold set before the player opens holds it from the start', () => {
    const { autoHide } = setup()
    autoHide.setHold('sidebar', true)
    autoHide.start()
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS * 2)
    expect(autoHide.visible).toBe(true)
  })

  it('hides at once when the pointer leaves the player, unless held', () => {
    const { autoHide } = setup()
    autoHide.start()
    autoHide.setHold('pointer', true)
    autoHide.pointerLeave()
    expect(autoHide.visible).toBe(false)

    autoHide.activity()
    autoHide.setHold('sidebar', true)
    autoHide.pointerLeave()
    expect(autoHide.visible).toBe(true)
  })

  it('does nothing once disposed', () => {
    const { autoHide, changes } = setup()
    autoHide.start()
    autoHide.dispose()
    vi.advanceTimersByTime(CONTROLS_HIDE_DELAY_MS * 2)
    autoHide.pointerMove(0, 0)
    autoHide.pointerMove(100, 100)
    autoHide.setHold('menu', true)
    autoHide.pointerLeave()
    expect(changes).toEqual([true])
    expect(vi.getTimerCount()).toBe(0)
  })
})
