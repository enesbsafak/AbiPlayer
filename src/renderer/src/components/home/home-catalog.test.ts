import { describe, expect, it } from 'vitest'
import { createCatalogStore, type CatalogStore } from '@/catalog/catalog-store'
import { m3uEntryToRecord } from '@/catalog/convert'
import type { CatalogCategory, CatalogType, CatalogViewSettings } from '@/catalog/types'
import type { Channel } from '@/types/playlist'
import { buildHomeCatalog, HOME_MAX_LIVE } from './home-catalog'

function channel(id: string, sourceId: string, type: Channel['type'], categoryId?: string): Channel {
  return { id, name: id, streamUrl: `http://example.test/${id}`, sourceId, type, categoryId }
}

function category(id: string, sourceId: string, type: CatalogType, isAdult = false): CatalogCategory {
  return { id, name: id, sourceId, type, isAdult }
}

function load(store: CatalogStore, channels: Channel[], categories: CatalogCategory[] = []): void {
  for (const type of ['live', 'vod', 'series'] as const) {
    for (const sourceId of new Set(channels.map((c) => c.sourceId))) {
      store.commit({
        token: store.beginGeneration(sourceId, type),
        mode: 'replace',
        items: channels.filter((c) => c.type === type && c.sourceId === sourceId).map(m3uEntryToRecord),
        categories: categories.filter((c) => c.type === type && c.sourceId === sourceId)
      })
    }
  }
}

function homeFor(store: CatalogStore, sourceId: string, settings: CatalogViewSettings) {
  const total = ['live', 'vod', 'series'].reduce(
    (sum, type) => sum + (store.getStatus(sourceId, type as CatalogType)?.count ?? 0),
    0
  )
  return buildHomeCatalog({
    live: store.getVisibleItems(sourceId, 'live', settings),
    vod: store.getVisibleItems(sourceId, 'vod', settings),
    series: store.getVisibleItems(sourceId, 'series', settings),
    totalCount: total
  })
}

const showAdult: CatalogViewSettings = { hiddenCategoryIds: new Set(['hidden']), showAdultContent: true }

describe('buildHomeCatalog', () => {
  const channels = [
    channel('a-live', 'a', 'live'),
    channel('a-hidden', 'a', 'live', 'hidden'),
    channel('a-adult', 'a', 'live', 'adult'),
    channel('a-vod', 'a', 'vod'),
    channel('b-live', 'b', 'live'),
    channel('b-series', 'b', 'series')
  ]
  const categories = [category('hidden', 'a', 'live'), category('adult', 'a', 'live', true)]

  it('counts and lists only the active source, without hidden categories', () => {
    const store = createCatalogStore()
    load(store, channels, categories)
    const home = homeFor(store, 'a', showAdult)

    expect(home.visibleCount).toBe(3)
    expect(home.recentLive.map((c) => c.id)).toEqual(['a-live', 'a-adult'])
    expect(home.recentVod.map((c) => c.id)).toEqual(['a-vod'])
    expect(home.recentSeries).toEqual([])
    expect(home.hasSourceContent).toBe(true)
  })

  it('puts adult content after the rest', () => {
    const store = createCatalogStore()
    load(store, [channel('x-adult', 'a', 'live', 'adult'), channel('x-clean', 'a', 'live')], categories)
    const home = homeFor(store, 'a', showAdult)
    expect(home.recentLive.map((c) => c.id)).toEqual(['x-clean', 'x-adult'])
  })

  it('leaves adult content out when the setting is off', () => {
    const store = createCatalogStore()
    load(store, channels, categories)
    const home = homeFor(store, 'a', { ...showAdult, showAdultContent: false })
    expect(home.recentLive.map((c) => c.id)).toEqual(['a-live'])
    expect(home.visibleCount).toBe(2)
  })

  it('reports an empty active source even when others have content', () => {
    const store = createCatalogStore()
    load(store, channels, categories)
    const home = homeFor(store, 'c', showAdult)
    expect(home.hasSourceContent).toBe(false)
    expect(home.visibleCount).toBe(0)
  })

  it('caps the rows', () => {
    const many = Array.from({ length: HOME_MAX_LIVE + 5 }, (_, i) => channel(`l${i}`, 'a', 'live'))
    const home = buildHomeCatalog({ live: many, vod: [], series: [], totalCount: many.length })
    expect(home.recentLive).toHaveLength(HOME_MAX_LIVE)
    expect(home.visibleCount).toBe(many.length)
  })
})
