import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Channel } from '@/types/playlist'
import { CHANNEL_GRID_LAYOUT, renderChannelCard } from '@/components/channels/ChannelGrid'
import { VirtualCardGrid, type VirtualCardGridHandle } from './VirtualCardGrid'

afterEach(cleanup)

function channels(count: number): Channel[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    name: `Kanal ${i}`,
    streamUrl: '',
    streamId: i + 1,
    sourceId: 's1',
    type: 'live' as const
  }))
}

function card(index: number) {
  return screen.getByRole('button', { name: `Kanal ${index} oynat` })
}

function renderGrid(items: Channel[], onOpen = vi.fn()) {
  const handle = createRef<VirtualCardGridHandle>()
  const view = render(
    <VirtualCardGrid
      items={items}
      layout={CHANNEL_GRID_LAYOUT}
      renderCard={renderChannelCard}
      onOpen={onOpen}
      ariaLabel="Kanallar"
      handleRef={handle}
    />
  )
  return { ...view, handle, onOpen }
}

// jsdom lays nothing out: the grid measures the minimum width, two columns.
describe('VirtualCardGrid keyboard model', () => {
  it('has one tab stop, and the arrows move it across cards and rows', () => {
    renderGrid(channels(12))
    const tabStops = () => screen.getAllByRole('button').filter((button) => button.tabIndex === 0)

    expect(tabStops()).toHaveLength(2) // the first card and its star
    act(() => card(0).focus())
    fireEvent.keyDown(card(0), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(card(1))
    fireEvent.keyDown(card(1), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(card(3))
    fireEvent.keyDown(card(3), { key: 'End', ctrlKey: true })
    expect(document.activeElement).toBe(card(11))
    expect(card(11).tabIndex).toBe(0)
    expect(card(0).tabIndex).toBe(-1)
  })

  it('moves from the favourite star too, and Enter opens through the native button', () => {
    const { onOpen } = renderGrid(channels(6))
    act(() => card(2).focus())
    const star = screen.getAllByRole('button', { name: 'Favorilere ekle' }).find((button) => button.tabIndex === 0)!
    fireEvent.keyDown(star, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(card(1))

    fireEvent.click(card(1))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }))
  })

  it('focuses a card by id through its handle', () => {
    const { handle } = renderGrid(channels(8))
    let found = false
    act(() => {
      found = handle.current!.focusItem('c7')
    })
    expect(found).toBe(true)
    expect(document.activeElement).toBe(card(7))
    expect(handle.current!.focusItem('missing')).toBe(false)
  })

  it('keeps the focus in the grid when the focused card goes away', () => {
    const items = channels(8)
    const { rerender } = renderGrid(items)
    act(() => card(7).focus())

    rerender(
      <VirtualCardGrid items={items.slice(0, 4)} layout={CHANNEL_GRID_LAYOUT} renderCard={renderChannelCard} onOpen={vi.fn()} ariaLabel="Kanallar" />
    )

    const grid = screen.getByRole('group', { name: 'Kanallar' })
    expect(document.activeElement).toBe(grid)
    // The next arrow brings back the (clamped) active card instead of doing nothing.
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(card(3))
  })
})
