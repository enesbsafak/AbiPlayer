import { describe, expect, it, vi } from 'vitest'
import { createCatalogStore } from './catalog-store'
import type { CatalogCategory, CatalogItem } from './types'

function item(id: string): CatalogItem {
  return { id, name: id, streamUrl: '', streamId: 1, sourceId: 's', type: 'live', searchName: id, isAdult: false }
}

const categories: CatalogCategory[] = [{ id: 'c1', name: 'Ulusal', sourceId: 's', type: 'live', isAdult: false }]

describe('staged replace (chunked commit)', () => {
  it('collects batches out of sight and swaps them in at once, as a complete list', () => {
    const store = createCatalogStore()
    store.commit({ token: store.beginGeneration('s', 'live'), mode: 'partial', items: [item('preview')] })
    const listener = vi.fn()
    store.subscribePartition('s', 'live', listener)

    const stage = store.beginReplace(store.beginGeneration('s', 'live'))
    stage.append([item('a'), item('b')])
    stage.append([item('b'), item('c')])
    expect(store.getItems('s', 'live').map((entry) => entry.id)).toEqual(['preview'])
    expect(listener).not.toHaveBeenCalled()
    expect(stage.count).toBe(3)

    expect(stage.finish({ categories, origin: { fromCache: true, fetchedAt: 1234 } })).toBe('committed')
    expect(store.getItems('s', 'live').map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(store.getItem('c')?.id).toBe('c')
    expect(store.getStatus('s', 'live')).toMatchObject({ complete: true, loaded: true, count: 3, categoriesLoaded: true, fromCache: true, fetchedAt: 1234, error: null })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('drops the swap of a source removed or refreshed meanwhile', () => {
    const store = createCatalogStore()
    const stage = store.beginReplace(store.beginGeneration('s', 'live'))
    stage.append([item('ghost')])
    store.removeSource('s')
    expect(stage.finish()).toBe('stale')
    expect(store.getStatus('s', 'live')).toBeNull()

    const refreshed = store.beginReplace(store.beginGeneration('s', 'live'))
    refreshed.append([item('old')])
    store.replaceSource('s', null)
    expect(refreshed.finish()).toBe('stale')
  })

  it('loses to a newer complete list, whichever finishes first', () => {
    const store = createCatalogStore()
    const fromCache = store.beginReplace(store.beginGeneration('s', 'live'))
    const fresh = store.beginGeneration('s', 'live')
    store.commit({ token: fresh, mode: 'replace', items: [item('fresh')] })
    fromCache.append([item('cached')])
    expect(fromCache.finish({ origin: { fromCache: true, fetchedAt: 1 } })).toBe('superseded')
    expect(store.getItems('s', 'live').map((entry) => entry.id)).toEqual(['fresh'])
    expect(store.getStatus('s', 'live')).toMatchObject({ fromCache: false })
  })

  it('marks a list from the provider as fresh and one from the cache as such', () => {
    const store = createCatalogStore()
    store.commit({ token: store.beginGeneration('s', 'live'), mode: 'replace', items: [item('a')], origin: { fromCache: true, fetchedAt: 5 } })
    expect(store.getStatus('s', 'live')).toMatchObject({ fromCache: true, fetchedAt: 5 })
    store.commit({ token: store.beginGeneration('s', 'live'), mode: 'replace', items: [item('a')] })
    expect(store.getStatus('s', 'live')).toMatchObject({ fromCache: false, fetchedAt: expect.any(Number) })
  })
})
