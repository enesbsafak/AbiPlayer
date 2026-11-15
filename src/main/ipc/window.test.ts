// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { HTCAPTION, WM_NCLBUTTONDBLCLK, installCaptionDoubleClick, readHitTest, toggleMaximize } from './window'

function fakeWindow(state: { maximized?: boolean; fullScreen?: boolean } = {}) {
  let maximized = state.maximized ?? false
  const hooks = new Map<number, (wParam: Buffer, lParam: Buffer) => void>()
  return {
    hooks,
    isMaximized: vi.fn(() => maximized),
    isFullScreen: vi.fn(() => state.fullScreen ?? false),
    maximize: vi.fn(() => {
      maximized = true
    }),
    unmaximize: vi.fn(() => {
      maximized = false
    }),
    hookWindowMessage: vi.fn((message: number, callback: (wParam: Buffer, lParam: Buffer) => void) => {
      hooks.set(message, callback)
    })
  }
}

function wParam(value: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32LE(value, 0)
  return buffer
}

describe('toggleMaximize', () => {
  it('maximizes a normal window and restores a maximized one', () => {
    const window = fakeWindow()
    toggleMaximize(window)
    expect(window.maximize).toHaveBeenCalledTimes(1)
    toggleMaximize(window)
    expect(window.unmaximize).toHaveBeenCalledTimes(1)
  })

  it('leaves a full-screen window alone', () => {
    const window = fakeWindow({ fullScreen: true })
    toggleMaximize(window)
    expect(window.maximize).not.toHaveBeenCalled()
    expect(window.unmaximize).not.toHaveBeenCalled()
  })
})

describe('installCaptionDoubleClick (F1-39)', () => {
  it('toggles the window on a non-client double click on the caption (the drag region)', () => {
    const window = fakeWindow()
    installCaptionDoubleClick(window, 'win32')
    const hook = window.hooks.get(WM_NCLBUTTONDBLCLK)
    expect(hook).toBeDefined()

    hook!(wParam(HTCAPTION), Buffer.alloc(8))
    expect(window.isMaximized()).toBe(true)
    hook!(wParam(HTCAPTION), Buffer.alloc(8))
    expect(window.isMaximized()).toBe(false)
  })

  it('ignores double clicks on other parts of the frame', () => {
    const window = fakeWindow()
    installCaptionDoubleClick(window, 'win32')
    const HTCLIENT = 1
    const HTTOP = 12
    window.hooks.get(WM_NCLBUTTONDBLCLK)!(wParam(HTCLIENT), Buffer.alloc(8))
    window.hooks.get(WM_NCLBUTTONDBLCLK)!(wParam(HTTOP), Buffer.alloc(8))
    expect(window.maximize).not.toHaveBeenCalled()
  })

  it('hooks nothing outside Windows', () => {
    const window = fakeWindow()
    installCaptionDoubleClick(window, 'darwin')
    expect(window.hookWindowMessage).not.toHaveBeenCalled()
  })

  it('reads the hit-test code from a pointer-sized WPARAM', () => {
    expect(readHitTest(wParam(2))).toBe(2)
    expect(readHitTest(Buffer.alloc(2))).toBeNull()
  })
})
