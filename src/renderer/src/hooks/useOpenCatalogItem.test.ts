import { describe, expect, it } from 'vitest'
import type { Channel } from '@/types/playlist'
import { planCatalogItemOpen } from './useOpenCatalogItem'

function channel(overrides: Partial<Channel>): Channel {
  return { id: 'x', name: 'X', streamUrl: '', sourceId: 'src', type: 'live', ...overrides }
}

describe('planCatalogItemOpen', () => {
  it('plays anything with a stream', () => {
    expect(planCatalogItemOpen(channel({ streamUrl: 'http://example.test/1.ts' }))).toEqual({
      kind: 'play'
    })
  })

  it('opens the series itself rather than the series list', () => {
    const plan = planCatalogItemOpen(channel({ type: 'series', seriesId: 42, sourceId: 'other' }))
    expect(plan).toEqual({
      kind: 'series',
      state: { restoreSelectedSeries: { seriesId: 42, sourceId: 'other' } }
    })
  })

  it('carries extra route state for the series page', () => {
    const plan = planCatalogItemOpen(channel({ type: 'series', seriesId: 1 }), {
      seriesRouteState: { restoreSearchQuery: 'abc' }
    })
    expect(plan).toEqual({
      kind: 'series',
      state: { restoreSearchQuery: 'abc', restoreSelectedSeries: { seriesId: 1, sourceId: 'src' } }
    })
  })

  it('falls back to the list for a series without an id, and ignores the rest', () => {
    expect(planCatalogItemOpen(channel({ type: 'series' }))).toEqual({ kind: 'series-list' })
    expect(planCatalogItemOpen(channel({ type: 'vod' }))).toEqual({ kind: 'none' })
  })
})
