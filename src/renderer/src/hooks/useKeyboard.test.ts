import { createElement, type ReactNode } from 'react'
import { cleanup, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return {
    ...actual,
    mpvTogglePause: vi.fn(() => Promise.resolve()),
    mpvSetVolume: vi.fn(() => Promise.resolve()),
    mpvSeek: vi.fn(() => Promise.resolve())
  }
})

import { mpvTogglePause } from '@/services/platform'
import { isTextEntryTarget, resolveKeyboardShortcut, useKeyboard } from './useKeyboard'

const live: Channel = {
  id: 'live-1',
  name: 'Kanal',
  streamUrl: 'https://example.com/live/1.ts',
  sourceId: 'src',
  type: 'live'
}

function input(type: string): HTMLInputElement {
  const element = document.createElement('input')
  element.type = type
  return element
}

function key(keyValue: string, target: EventTarget | null = document.body) {
  return { key: keyValue, metaKey: false, ctrlKey: false, altKey: false, target }
}

describe('isTextEntryTarget', () => {
  it('treats sliders and buttons as non-text controls', () => {
    expect(isTextEntryTarget(input('range'))).toBe(false)
    expect(isTextEntryTarget(input('checkbox'))).toBe(false)
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false)
  })

  it('still protects fields the viewer types into', () => {
    expect(isTextEntryTarget(input('text'))).toBe(true)
    expect(isTextEntryTarget(input('search'))).toBe(true)
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true)
    expect(isTextEntryTarget(document.createElement('select'))).toBe(true)
  })
})

describe('resolveKeyboardShortcut', () => {
  const onPlayer = { pathname: '/player', hasChannel: true }

  it('maps playback keys on the player route', () => {
    expect(resolveKeyboardShortcut(key(' '), onPlayer)).toBe('toggle-play')
    expect(resolveKeyboardShortcut(key('ArrowLeft'), onPlayer)).toBe('seek-back')
    expect(resolveKeyboardShortcut(key('ArrowUp'), onPlayer)).toBe('volume-up')
    expect(resolveKeyboardShortcut(key('l'), onPlayer)).toBe('toggle-sidebar')
  })

  it('keeps working after the seek bar or volume slider was clicked', () => {
    expect(resolveKeyboardShortcut(key(' ', input('range')), onPlayer)).toBe('toggle-play')
    expect(resolveKeyboardShortcut(key('ArrowRight', input('range')), onPlayer)).toBe('seek-forward')
  })

  it('leaves keys alone while typing', () => {
    expect(resolveKeyboardShortcut(key(' ', input('text')), onPlayer)).toBeNull()
  })

  it('leaves Space, arrows and L to the page outside the player, even with a mini card up', () => {
    const miniCard = { pathname: '/live', hasChannel: true }
    for (const value of [' ', 'k', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'm', 'f', 'l']) {
      expect(resolveKeyboardShortcut(key(value), miniCard)).toBeNull()
    }
  })

  it('keeps the global search shortcut everywhere', () => {
    expect(
      resolveKeyboardShortcut({ ...key('k'), ctrlKey: true }, { pathname: '/live', hasChannel: false })
    ).toBe('search')
  })
})

describe('useKeyboard', () => {
  function renderOn(pathname: string) {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: [pathname] }, children)
    return renderHook(() => useKeyboard(), { wrapper })
  }

  function press(keyValue: string, target: HTMLElement = document.body): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: keyValue, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }

  beforeEach(() => {
    useStore.getState().playChannel(live)
    useStore.getState().setPlaybackEngine('mpv')
    useStore.getState().setVolume(0.5)
  })

  afterEach(() => {
    // Without vitest globals, testing-library cannot register its own cleanup.
    cleanup()
    useStore.getState().stopPlayback()
    document.body.innerHTML = ''
  })

  it('does not swallow Space on a catalog page while the mini card is shown', () => {
    renderOn('/live')
    const event = press(' ')
    expect(event.defaultPrevented).toBe(false)
    expect(vi.mocked(mpvTogglePause)).not.toHaveBeenCalled()
  })

  it('toggles playback with Space on the player route', () => {
    renderOn('/player')
    const event = press(' ')
    expect(event.defaultPrevented).toBe(true)
    expect(vi.mocked(mpvTogglePause)).toHaveBeenCalledTimes(1)
  })

  it('still changes the volume after the volume slider took focus', () => {
    renderOn('/player')
    const slider = input('range')
    document.body.appendChild(slider)

    const event = press('ArrowUp', slider)

    expect(event.defaultPrevented).toBe(true)
    expect(useStore.getState().volume).toBeCloseTo(0.55)
  })
})
