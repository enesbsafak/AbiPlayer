import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTROLS_HIDE_DELAY_MS } from '@/components/player/controls-autohide'
import { useControlsAutoHide } from './useControlsAutoHide'

let visible = true

function Harness({ isSidebarOpen = false }: { isSidebarOpen?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const autoHide = useControlsAutoHide({
    setVisible: (next) => {
      visible = next
    },
    isSidebarOpen,
    hasError: false
  })
  return (
    <div data-testid="player" onMouseMove={autoHide.onMouseMove} onMouseLeave={autoHide.onMouseLeave}>
      <div data-testid="picture" />
      <div ref={autoHide.controlsRef} onFocus={autoHide.onControlsFocus} onBlur={autoHide.onControlsBlur}>
        <section data-player-controls>
          <button type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            Altyazı
          </button>
          <button type="button">Oynat</button>
        </section>
      </div>
      <button type="button">Dışarıda</button>
    </div>
  )
}

/** MutationObserver callbacks run as microtasks. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('useControlsAutoHide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    visible = false
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows the controls on open and hides them without any mouse movement', () => {
    render(<Harness />)
    expect(visible).toBe(true)
    advance(CONTROLS_HIDE_DELAY_MS)
    expect(visible).toBe(false)
  })

  it('keeps them up while the pointer rests on them', () => {
    render(<Harness />)
    fireEvent.mouseMove(screen.getByText('Oynat'), { clientX: 10, clientY: 10 })
    advance(CONTROLS_HIDE_DELAY_MS * 3)
    expect(visible).toBe(true)

    fireEvent.mouseMove(screen.getByTestId('picture'), { clientX: 300, clientY: 10 })
    advance(CONTROLS_HIDE_DELAY_MS)
    expect(visible).toBe(false)
  })

  it('keeps them up while a menu is open', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Altyazı'))
    await flush()
    advance(CONTROLS_HIDE_DELAY_MS * 3)
    expect(visible).toBe(true)

    fireEvent.click(screen.getByText('Altyazı'))
    await flush()
    advance(CONTROLS_HIDE_DELAY_MS)
    expect(visible).toBe(false)
  })

  it('keeps them up while keyboard focus is inside, and shows them when it moves in', () => {
    render(<Harness />)
    advance(CONTROLS_HIDE_DELAY_MS)
    expect(visible).toBe(false)

    fireEvent.keyDown(document, { key: 'Tab' })
    act(() => screen.getByText('Oynat').focus())
    expect(visible).toBe(true)
    advance(CONTROLS_HIDE_DELAY_MS * 3)
    expect(visible).toBe(true)

    // Moving within the controls keeps the hold; leaving them ends it.
    act(() => screen.getByText('Altyazı').focus())
    advance(CONTROLS_HIDE_DELAY_MS * 3)
    expect(visible).toBe(true)
    act(() => screen.getByText('Dışarıda').focus())
    advance(CONTROLS_HIDE_DELAY_MS)
    expect(visible).toBe(false)
  })

  it('does not hold them for the focus a mouse click leaves on a button', () => {
    render(<Harness />)
    fireEvent.pointerDown(screen.getByText('Oynat'))
    act(() => screen.getByText('Oynat').focus())
    advance(CONTROLS_HIDE_DELAY_MS)
    expect(visible).toBe(false)
  })

  it('keeps them up while the channel list is open', () => {
    const { rerender } = render(<Harness isSidebarOpen />)
    advance(CONTROLS_HIDE_DELAY_MS * 3)
    expect(visible).toBe(true)
    rerender(<Harness isSidebarOpen={false} />)
    advance(CONTROLS_HIDE_DELAY_MS)
    expect(visible).toBe(false)
  })
})
