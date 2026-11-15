import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CatalogItem } from '@/catalog/types'
import type { EPGProgram } from '@/types/epg'
import { GuideTimeline } from './GuideTimeline'
import { HOUR_MS, MINUTE_MS, indexByStart, type GuideFocus, type GuideRow } from './guide-model'

afterEach(cleanup)

// jsdom lays nothing out: give every element the size of a 1280 × 800 window's timeline.
const sizes = ['offsetWidth', 'clientWidth', 'offsetHeight', 'clientHeight'] as const
const saved = sizes.map((key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const)
beforeAll(() => {
  for (const key of sizes) {
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => (key.includes('Width') ? 1232 : 480) })
  }
})
afterAll(() => {
  for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
})

const NOW = new Date(2026, 10, 15, 20, 42).getTime()
const slot = 30 * MINUTE_MS
const firstSlot = Math.floor(NOW / slot) * slot - 6 * HOUR_MS

function channel(index: number): CatalogItem {
  return { id: `c${index}`, name: `Kanal ${index}`, streamUrl: '', streamId: index, sourceId: 's', type: 'live', searchName: `kanal ${index}`, isAdult: false }
}

function rows(count: number): GuideRow[] {
  return Array.from({ length: count }, (_, row) => ({
    channel: channel(row + 1),
    programs: Array.from({ length: 60 }, (_, index): EPGProgram => ({
      channelId: `c${row + 1}`,
      title: `Program ${index} kanal ${row + 1}`,
      start: firstSlot + index * slot,
      end: firstSlot + (index + 1) * slot
    }))
  }))
}

const currentIndex = Math.floor((NOW - firstSlot) / slot)

function Harness({ data, onPlay = vi.fn(), onToggleFavorite = vi.fn() }: { data: GuideRow[]; onPlay?: (row: number) => void; onToggleFavorite?: (row: number) => void }) {
  const [focus, setFocus] = useState<GuideFocus>({ rowIndex: 0, index: currentIndex })
  return (
    <GuideTimeline
      rows={data}
      focus={focus}
      now={NOW}
      formatTime={(ts) => new Date(ts).toTimeString().slice(0, 5)}
      favoriteIds={new Set(['c2'])}
      onFocusChange={(rowIndex, start) => setFocus({ rowIndex, index: indexByStart(data[rowIndex]!.programs, start) })}
      onPlay={onPlay}
      onToggleFavorite={onToggleFavorite}
    />
  )
}

function focusedBlock() {
  return screen.getAllByRole('button', { pressed: true })[0]!
}

describe('GuideTimeline', () => {
  it('draws a screenful of rows, each with what is on now, and leaves far programmes out', () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    render(<Harness data={rows(4000)} />)
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBeLessThan(40)
    const first = screen.getByRole('listitem', { name: 'Kanal 1' })
    expect(first.textContent).toContain('Şimdi')
    expect(first.textContent).toContain(`Program ${currentIndex} kanal 1`)
    // Only the drawn window's programmes exist: not the 60 of the row.
    expect(within(first).getAllByRole('button').length).toBeLessThan(15)
    expect(within(screen.getByRole('listitem', { name: 'Kanal 2' })).getByRole('img', { name: 'Favori' })).toBeTruthy()
    vi.useRealTimers()
  })

  it('moves along a row and between channels with the arrows, plays with Enter, favours with F', () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const onPlay = vi.fn()
    const onToggleFavorite = vi.fn()
    render(<Harness data={rows(20)} onPlay={onPlay} onToggleFavorite={onToggleFavorite} />)
    const start = focusedBlock()
    act(() => start.focus())

    fireEvent.keyDown(start, { key: 'ArrowRight' })
    expect(focusedBlock().getAttribute('aria-label')).toContain(`Program ${currentIndex + 1} kanal 1`)
    fireEvent.keyDown(focusedBlock(), { key: 'ArrowDown' })
    expect(focusedBlock().getAttribute('aria-label')).toContain(`Program ${currentIndex + 1} kanal 2`)
    expect(document.activeElement).toBe(focusedBlock())
    fireEvent.keyDown(focusedBlock(), { key: 'ArrowLeft' })
    expect(focusedBlock().getAttribute('aria-label')).toMatch(new RegExp(`Program ${currentIndex} kanal 2, .*, şimdi yayında$`))
    expect(focusedBlock().tabIndex).toBe(0)

    fireEvent.keyDown(focusedBlock(), { key: 'Enter' })
    expect(onPlay).toHaveBeenCalledWith(1)
    fireEvent.keyDown(focusedBlock(), { key: 'f' })
    expect(onToggleFavorite).toHaveBeenCalledWith(1)
    vi.useRealTimers()
  })
})
