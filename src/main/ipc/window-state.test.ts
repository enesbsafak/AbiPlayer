// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_STATE,
  WindowStateTracker,
  isStateOnScreen,
  parseWindowState,
  type Rect,
  type TrackedWindow
} from './window-state'

class FakeWindow implements TrackedWindow {
  maximized = false
  minimized = false
  fullScreen = false
  normal: Rect = { x: 100, y: 80, width: 1280, height: 800 }
  screen: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

  isMaximized(): boolean {
    return this.maximized && !this.fullScreen && !this.minimized
  }
  isMinimized(): boolean {
    return this.minimized
  }
  isFullScreen(): boolean {
    return this.fullScreen
  }
  getBounds(): Rect {
    if (this.fullScreen || this.maximized) return this.screen
    if (this.minimized) return { x: -32000, y: -32000, width: 160, height: 28 }
    return this.normal
  }
  getNormalBounds(): Rect {
    return this.normal
  }
}

describe('WindowStateTracker', () => {
  it('saves normal bounds and size when the window is normal', () => {
    const window = new FakeWindow()
    expect(new WindowStateTracker(window).capture()).toEqual({ ...window.normal, isMaximized: false })
  })

  // Regression: closing in fullscreen saved the whole screen as the normal size.
  it('does not save fullscreen bounds as the normal size', () => {
    const window = new FakeWindow()
    const tracker = new WindowStateTracker(window)
    window.fullScreen = true
    expect(tracker.capture()).toEqual({ ...window.normal, isMaximized: false })
  })

  it('does not save the minimized placeholder as the normal size', () => {
    const window = new FakeWindow()
    const tracker = new WindowStateTracker(window)
    window.minimized = true
    expect(tracker.capture()).toEqual({ ...window.normal, isMaximized: false })
  })

  it('remembers maximized through fullscreen and minimize', () => {
    const window = new FakeWindow()
    const tracker = new WindowStateTracker(window)
    window.maximized = true
    tracker.onMaximizeChanged()

    window.fullScreen = true
    tracker.onMaximizeChanged() // an unmaximize fired while entering fullscreen is ignored
    expect(tracker.capture()).toEqual({ ...window.normal, isMaximized: true })

    window.fullScreen = false
    window.minimized = true
    expect(tracker.capture().isMaximized).toBe(true)

    window.minimized = false
    window.maximized = false
    tracker.onMaximizeChanged()
    expect(tracker.capture().isMaximized).toBe(false)
  })

  it('starts from the saved maximized flag before the window has been maximized', () => {
    const window = new FakeWindow()
    expect(new WindowStateTracker(window, true).capture().isMaximized).toBe(true)
  })
})

describe('parseWindowState', () => {
  it('falls back to defaults for malformed data', () => {
    expect(parseWindowState(null)).toEqual(DEFAULT_WINDOW_STATE)
    expect(parseWindowState({ width: 'wide', height: -5, isMaximized: 'yes' })).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('keeps valid values and enforces the minimum size', () => {
    expect(parseWindowState({ x: 10.4, y: 20, width: 500, height: 2000, isMaximized: true })).toEqual({
      x: 10,
      y: 20,
      width: 900,
      height: 2000,
      isMaximized: true
    })
  })
})

describe('isStateOnScreen', () => {
  const workAreas: Rect[] = [{ x: 0, y: 0, width: 1920, height: 1040 }]

  it('accepts a position on a display and rejects one on a disconnected monitor', () => {
    expect(isStateOnScreen({ x: 100, y: 100, width: 1280, height: 800, isMaximized: false }, workAreas)).toBe(true)
    expect(isStateOnScreen({ x: 2500, y: 100, width: 1280, height: 800, isMaximized: false }, workAreas)).toBe(false)
    expect(isStateOnScreen({ width: 1280, height: 800, isMaximized: false }, workAreas)).toBe(true)
  })
})
