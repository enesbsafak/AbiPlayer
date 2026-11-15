import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WindowStateInfo } from '@/services/platform'

const bridge = vi.hoisted(() => ({
  listeners: new Set<(state: WindowStateInfo) => void>(),
  answer: null as null | ((state: WindowStateInfo) => void)
}))

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return {
    ...actual,
    windowGetState: vi.fn(
      () =>
        new Promise<WindowStateInfo>((resolve) => {
          bridge.answer = resolve
        })
    ),
    onWindowStateChange: vi.fn((listener: (state: WindowStateInfo) => void) => {
      bridge.listeners.add(listener)
      return () => bridge.listeners.delete(listener)
    })
  }
})

import { maximizeButtonText, useWindowMaximized } from './WindowControls'

function emit(state: WindowStateInfo) {
  act(() => {
    for (const listener of bridge.listeners) listener(state)
  })
}

describe('window controls maximize state (F1-39)', () => {
  afterEach(() => {
    cleanup()
    bridge.listeners.clear()
  })

  it('starts from the window state main reports and follows its events', async () => {
    const { result } = renderHook(() => useWindowMaximized())
    expect(result.current).toBe(false)
    await act(async () => bridge.answer?.({ isMaximized: true, isFullScreen: false }))
    expect(result.current).toBe(true)

    emit({ isMaximized: false, isFullScreen: false })
    expect(result.current).toBe(false)
  })

  it('lets a state event win over a slower first read', async () => {
    const { result } = renderHook(() => useWindowMaximized())
    emit({ isMaximized: true, isFullScreen: false })
    await act(async () => bridge.answer?.({ isMaximized: false, isFullScreen: false }))
    expect(result.current).toBe(true)
  })

  it('names the button after what it will do', () => {
    expect(maximizeButtonText(false)).toEqual({ title: 'Büyüt', label: 'Pencereyi büyüt' })
    expect(maximizeButtonText(true)).toEqual({ title: 'Önceki Boyut', label: 'Pencereyi önceki boyutuna getir' })
  })
})
