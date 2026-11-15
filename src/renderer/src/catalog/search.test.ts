import { describe, expect, it } from 'vitest'
import { createCatalogStore } from './catalog-store'
import { m3uEntryToRecord } from './convert'
import { filterBySearch, searchCatalog, searchCatalogWithTotal } from './search'
import type { CatalogType } from './types'

const settings = { hiddenCategoryIds: new Set<string>(), showAdultContent: true }

function record(id: string, name: string, type: CatalogType = 'live', isAdult = false) {
  return { ...m3uEntryToRecord({ id, name, streamUrl: `http://cdn.test/${id}`, sourceId: 's1', type }), isAdult }
}

function storeWith(items: ReturnType<typeof record>[]) {
  const store = createCatalogStore()
  for (const type of ['live', 'vod'] as const) {
    store.commit({
      token: store.beginGeneration('s1', type),
      mode: 'replace',
      items: items.filter((item) => item.type === type)
    })
  }
  return store
}

describe('catalog search', () => {
  it('reports every match while drawing only the limit (F4-07)', () => {
    const items = Array.from({ length: 250 }, (_, i) => record(`k${i}`, `Kanal ${i}`))
    const store = storeWith(items)

    const result = searchCatalogWithTotal(store, 'kanal', settings, 100)

    expect(result.items).toHaveLength(100)
    expect(result.total).toBe(250)
    expect(searchCatalog(store, 'kanal', settings, 100)).toEqual(result.items)
  })

  it('counts across types and lists clean matches before adult ones', () => {
    const store = storeWith([
      record('a', 'Gece Kuşu', 'live', true),
      record('b', 'Gece Haberleri'),
      record('c', 'Gece Yarısı', 'vod')
    ])

    const result = searchCatalogWithTotal(store, 'GECE', settings, 2)

    expect(result.total).toBe(3)
    expect(result.items.map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('matches the query the way names were normalized at ingest', () => {
    const store = storeWith([record('a', 'Çift Dilli Gece'), record('b', 'İstanbul'), record('c', 'IZLE')])
    expect(searchCatalogWithTotal(store, 'ÇİFT', settings, 10).total).toBe(1)
    expect(searchCatalogWithTotal(store, 'istanbul', settings, 10).total).toBe(1)
    expect(searchCatalogWithTotal(store, 'izle', settings, 10).total).toBe(1)
  })

  it('returns nothing for an empty query', () => {
    expect(searchCatalogWithTotal(storeWith([record('a', 'A')]), '  ', settings, 10)).toEqual({ items: [], total: 0 })
  })

  it('filters a page list uncapped, so its length is the true count', () => {
    const items = Array.from({ length: 1200 }, (_, i) => record(`f${i}`, i % 2 ? `Film ${i}` : `Dizi ${i}`, 'vod'))
    expect(filterBySearch(items, 'film')).toHaveLength(600)
  })
})
