import { describe, expect, it } from 'vitest'
import type { Channel } from '@/types/playlist'
import { buildHomeCatalog } from './home-catalog'

function channel(id: string, sourceId: string, type: Channel['type'], categoryId?: string): Channel {
  return { id, name: id, streamUrl: `http://example.test/${id}`, sourceId, type, categoryId }
}

const view = { hiddenCategoryIds: new Set(['hidden']), adultCategoryIds: new Set(['adult']) }

describe('buildHomeCatalog', () => {
  const channels = [
    channel('a-live', 'a', 'live'),
    channel('a-hidden', 'a', 'live', 'hidden'),
    channel('a-adult', 'a', 'live', 'adult'),
    channel('a-vod', 'a', 'vod'),
    channel('b-live', 'b', 'live'),
    channel('b-series', 'b', 'series')
  ]

  it('counts and lists only the active source, without hidden categories', () => {
    const home = buildHomeCatalog(channels, 'a', view)

    expect(home.visibleCount).toBe(3)
    expect(home.recentLive.map((c) => c.id)).toEqual(['a-live', 'a-adult'])
    expect(home.recentVod.map((c) => c.id)).toEqual(['a-vod'])
    expect(home.recentSeries).toEqual([])
    expect(home.hasSourceContent).toBe(true)
  })

  it('puts adult content after the rest', () => {
    const home = buildHomeCatalog(
      [channel('x-adult', 'a', 'live', 'adult'), channel('x-clean', 'a', 'live')],
      'a',
      view
    )
    expect(home.recentLive.map((c) => c.id)).toEqual(['x-clean', 'x-adult'])
  })

  it('reports an empty active source even when others have content', () => {
    const home = buildHomeCatalog(channels, 'c', view)
    expect(home.hasSourceContent).toBe(false)
    expect(home.visibleCount).toBe(0)
  })
})
