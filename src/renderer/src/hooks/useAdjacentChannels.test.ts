import { describe, expect, it } from 'vitest'
import type { Channel } from '@/types/playlist'
import { findAdjacent, positionInList } from './useAdjacentChannels'

function live(id: string, playable = true): Channel {
  return { id, name: id, streamUrl: '', sourceId: 's1', type: 'live', ...(playable ? { streamId: Number(id.replace(/\D/g, '')) || 1 } : {}) }
}

describe('adjacent channel lookup', () => {
  it('finds the position from an index built once per list', () => {
    const list = [live('a1'), live('b2'), live('c3')]
    expect(positionInList(list, 'c3')).toBe(2)
    expect(positionInList(list, 'zz')).toBe(-1)
    // Same array, same answers: the store hands out one array per version.
    expect(positionInList(list, 'a1')).toBe(0)
  })

  it('skips entries that cannot be played', () => {
    const list = [live('a1'), live('x', false), live('b2'), live('y', false), live('c3')]
    expect(findAdjacent([list], 'b2')).toEqual({ previous: list[0], next: list[4] })
    expect(findAdjacent([list], 'a1')).toEqual({ previous: null, next: list[2] })
  })

  it('uses the first list that contains the channel', () => {
    const browsed = [live('a1'), live('b2')]
    const own = [live('c3'), live('d4'), live('e5')]
    const all = [...browsed, ...own]
    // Opened from search: not in the browsed category, so its own category decides.
    expect(findAdjacent([browsed, own, all], 'd4')).toEqual({ previous: own[0], next: own[2] })
    expect(findAdjacent([browsed, own, all], 'b2')).toEqual({ previous: browsed[0], next: null })
    expect(findAdjacent([browsed, own], 'nowhere')).toEqual({ previous: null, next: null })
  })

  it('stays fast on a 200,000 item list', () => {
    const list = Array.from({ length: 200_000 }, (_, i) => live(`c${i + 1}`))
    positionInList(list, 'c1')
    const started = performance.now()
    for (let i = 0; i < 1000; i++) findAdjacent([list], `c${190_000 + i}`)
    // A scan per lookup would take seconds here.
    expect(performance.now() - started).toBeLessThan(200)
  })
})
