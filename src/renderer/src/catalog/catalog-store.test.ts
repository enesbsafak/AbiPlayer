import { describe, expect, it, vi } from 'vitest'
import { createCatalogStore, type CatalogStore } from './catalog-store'
import { m3uEntryToRecord, xtreamCategoriesToRecords, xtreamLiveToRecords } from './convert'
import { filterBySearch, searchCatalog } from './search'
import type { CatalogCategory, CatalogItem, CatalogType, CatalogViewSettings } from './types'
import type { XtreamLiveStream } from '@/types/xtream'

function item(id: string, extra: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id,
    name: id,
    streamUrl: `http://cdn.test/${id}.ts`,
    sourceId: 's1',
    type: 'live',
    searchName: id.toLowerCase(),
    isAdult: false,
    ...extra
  }
}

function category(id: string, extra: Partial<CatalogCategory> = {}): CatalogCategory {
  return { id, name: id, sourceId: 's1', type: 'live', isAdult: false, ...extra }
}

function ids(list: readonly { id: string }[]): string[] {
  return list.map((entry) => entry.id)
}

function replace(store: CatalogStore, items: CatalogItem[], type: CatalogType = 'live', sourceId = 's1') {
  return store.commit({ token: store.beginGeneration(sourceId, type), mode: 'replace', items })
}

function stream(id: number, extra: Partial<XtreamLiveStream> = {}): XtreamLiveStream {
  return {
    num: id, name: `Kanal ${id}`, stream_type: 'live', stream_id: id, stream_icon: '', epg_channel_id: '',
    added: '', is_adult: false, category_id: '1', category_ids: [], custom_sid: '', tv_archive: false,
    direct_source: '', tv_archive_duration: 0, ...extra
  }
}

const allVisible: CatalogViewSettings = { hiddenCategoryIds: new Set(), showAdultContent: true }

describe('catalog store generations', () => {
  it('replaces the whole list, so items the provider removed disappear', () => {
    const store = createCatalogStore()
    replace(store, [item('a'), item('b'), item('c')])
    replace(store, [item('c'), item('d')])

    expect(ids(store.getItems('s1', 'live'))).toEqual(['c', 'd'])
    expect(store.getItem('a')).toBeUndefined()
    expect(store.getItem('d')?.id).toBe('d')
    expect(store.getStatus('s1', 'live')).toMatchObject({ count: 2, complete: true, loaded: true })
  })

  it('drops a commit for a source removed after the sync started', () => {
    const store = createCatalogStore()
    const token = store.beginGeneration('s1', 'live')
    store.removeSource('s1')

    expect(store.commit({ token, mode: 'replace', items: [item('ghost')] })).toBe('stale')
    expect(store.getStatus('s1', 'live')).toBeNull()
    expect(store.getItem('ghost')).toBeUndefined()
  })

  it('drops a commit for a source refreshed after the sync started', () => {
    const store = createCatalogStore()
    const token = store.beginGeneration('s1', 'live')
    store.replaceSource('s1', { live: { items: [item('fresh')], categories: [] } })

    expect(store.commit({ token, mode: 'partial', items: [item('old')] })).toBe('stale')
    expect(ids(store.getItems('s1', 'live'))).toEqual(['fresh'])
  })

  it('drops a refresh whose source changed while it was fetching', () => {
    const store = createCatalogStore()
    const revision = store.getSourceRevision('s1')
    store.removeSource('s1')

    expect(store.replaceSource('s1', { live: { items: [item('ghost')], categories: [] } }, revision)).toBe(false)
    expect(store.getStatus('s1', 'live')).toBeNull()
  })

  it('aborts the signal of a source when it is removed or refreshed', () => {
    const store = createCatalogStore()
    const first = store.sourceSignal('s1')
    store.replaceSource('s1', null)
    expect(first.aborted).toBe(true)

    const second = store.sourceSignal('s1')
    expect(second.aborted).toBe(false)
    store.removeSource('s1')
    expect(second.aborted).toBe(true)
  })

  it('never lets a partial batch claim completeness, and a complete list wins over an older batch', () => {
    const store = createCatalogStore()
    const early = store.beginGeneration('s1', 'live')
    store.commit({ token: store.beginGeneration('s1', 'live'), mode: 'partial', items: [item('preview')] })
    expect(store.getStatus('s1', 'live')).toMatchObject({ loaded: true, complete: false, count: 1 })

    replace(store, [item('a'), item('b')])
    expect(store.getStatus('s1', 'live')?.complete).toBe(true)

    // Begun before the complete list was committed: it would put back what the
    // full list just dropped.
    expect(store.commit({ token: early, mode: 'partial', items: [item('preview')] })).toBe('superseded')
    expect(ids(store.getItems('s1', 'live'))).toEqual(['a', 'b'])

    // A later batch (a category fetched on demand) is merged and keeps the list complete.
    store.commit({ token: store.beginGeneration('s1', 'live'), mode: 'partial', items: [item('b', { name: 'B2' }), item('c')] })
    expect(ids(store.getItems('s1', 'live'))).toEqual(['a', 'b', 'c'])
    expect(store.getItem('b')?.name).toBe('B2')
    expect(store.getStatus('s1', 'live')?.complete).toBe(true)
  })

  it('drops an older complete list that finishes after a newer one', () => {
    const store = createCatalogStore()
    const older = store.beginGeneration('s1', 'live')
    replace(store, [item('new')])
    expect(store.commit({ token: older, mode: 'replace', items: [item('old')] })).toBe('superseded')
    expect(ids(store.getItems('s1', 'live'))).toEqual(['new'])
  })

  it('keeps a category list that arrives after a complete item list begun later', () => {
    const store = createCatalogStore()
    const categoriesToken = store.beginGeneration('s1', 'live')
    replace(store, [item('a', { categoryId: 'c1' })])

    expect(store.commit({ token: categoriesToken, mode: 'partial', categories: [category('c1')] })).toBe('committed')
    expect(ids(store.getCategories('s1', 'live'))).toEqual(['c1'])
    expect(store.getStatus('s1', 'live')?.categoriesLoaded).toBe(true)
  })

  it('keeps the first of duplicate ids in a complete list and updates in place in a batch', () => {
    const store = createCatalogStore()
    replace(store, [item('a', { name: 'first' }), item('b'), item('a', { name: 'second' })])
    expect(ids(store.getItems('s1', 'live'))).toEqual(['a', 'b'])
    expect(store.getItem('a')?.name).toBe('first')

    store.commit({
      token: store.beginGeneration('s1', 'live'),
      mode: 'partial',
      items: [item('c'), item('c', { name: 'dup' }), item('a', { name: 'updated' })]
    })
    expect(ids(store.getItems('s1', 'live'))).toEqual(['a', 'b', 'c'])
    expect(store.getItem('a')?.name).toBe('updated')
    expect(store.getItem('c')?.name).toBe('c')
  })

  it('keeps two sources with the same provider ids apart', () => {
    const store = createCatalogStore()
    replace(store, xtreamLiveToRecords([stream(1)], 'a'), 'live', 'a')
    replace(store, xtreamLiveToRecords([stream(1, { name: 'Başka' })], 'b'), 'live', 'b')

    expect(store.getItem('a_live_1')?.sourceId).toBe('a')
    expect(store.getItem('b_live_1')?.name).toBe('Başka')

    store.removeSource('a')
    expect(store.getItem('a_live_1')).toBeUndefined()
    expect(ids(store.getItems('b', 'live'))).toEqual(['b_live_1'])
  })

  it('marks a refreshed source incomplete but keeps its items on screen', () => {
    const store = createCatalogStore()
    replace(store, [item('a')])
    store.replaceSource('s1', null)

    expect(ids(store.getItems('s1', 'live'))).toEqual(['a'])
    expect(store.getStatus('s1', 'live')).toMatchObject({ complete: false, loaded: true, categoriesLoaded: false })
  })

  it('swaps a whole source, giving types missing from the replacement an empty complete list', () => {
    const store = createCatalogStore()
    replace(store, [item('v', { type: 'vod' })], 'vod')
    store.replaceSource('s1', { live: { items: [item('a')], categories: [category('c1')] } })

    expect(ids(store.getItems('s1', 'live'))).toEqual(['a'])
    expect(store.getItems('s1', 'vod')).toEqual([])
    expect(store.getStatus('s1', 'vod')).toMatchObject({ complete: true, count: 0 })
  })

  it('records sync state only for a current token', () => {
    const store = createCatalogStore()
    const token = store.beginGeneration('s1', 'vod')
    store.setSyncState(token, { syncing: true })
    expect(store.getStatus('s1', 'vod')?.syncing).toBe(true)

    store.removeSource('s1')
    expect(store.setSyncState(token, { syncing: false, error: { kind: 'network', message: 'x', retryable: true } })).toBe(
      false
    )
    expect(store.getStatus('s1', 'vod')).toBeNull()
  })

  it('knows which categories are in memory as a whole', () => {
    const store = createCatalogStore()
    store.commit({
      token: store.beginGeneration('s1', 'live'),
      mode: 'partial',
      items: [item('a', { categoryId: 'c1' })],
      categoryId: 'c1'
    })
    // A preview that happens to contain an item of c2 does not make c2 loaded.
    store.commit({ token: store.beginGeneration('s1', 'live'), mode: 'partial', items: [item('b', { categoryId: 'c2' })] })

    expect(store.isCategoryLoaded('s1', 'live', 'c1')).toBe(true)
    expect(store.isCategoryLoaded('s1', 'live', 'c2')).toBe(false)
    replace(store, [item('a', { categoryId: 'c1' })])
    expect(store.isCategoryLoaded('s1', 'live', 'c2')).toBe(true)
  })
})

describe('catalog store view', () => {
  const items = [
    item('adult-first', { isAdult: true }),
    item('in-adult-category', { categoryId: 'c-adult' }),
    item('hidden', { categoryId: 'c-hidden' }),
    item('clean', { categoryId: 'c-clean' }),
    item('plain')
  ]
  const categories = [category('c-adult', { isAdult: true }), category('c-hidden'), category('c-clean')]

  function loaded(): CatalogStore {
    const store = createCatalogStore()
    store.commit({ token: store.beginGeneration('s1', 'live'), mode: 'replace', items, categories })
    return store
  }

  it('hides adult items and categories when adult content is off (F1-53)', () => {
    const store = loaded()
    const settings = { hiddenCategoryIds: new Set(['c-hidden']), showAdultContent: false }
    expect(ids(store.getVisibleItems('s1', 'live', settings))).toEqual(['clean', 'plain'])
    expect(ids(store.getVisibleCategories('s1', 'live', settings))).toEqual(['c-clean'])
  })

  it('lists adult content last when it is on', () => {
    const store = loaded()
    const settings = { hiddenCategoryIds: new Set(['c-hidden']), showAdultContent: true }
    expect(ids(store.getVisibleItems('s1', 'live', settings))).toEqual([
      'clean',
      'plain',
      'adult-first',
      'in-adult-category'
    ])
    expect(ids(store.getVisibleItems('s1', 'live', settings, 'c-clean'))).toEqual(['clean'])
    expect(ids(store.getVisibleCategories('s1', 'live', settings, { includeHidden: true }))).toEqual([
      'c-hidden',
      'c-clean',
      'c-adult'
    ])
  })

  it('computes a view once per slice and keeps it across status-only changes', () => {
    const store = loaded()
    const first = store.getVisibleItems('s1', 'live', allVisible)
    expect(store.getVisibleItems('s1', 'live', { ...allVisible })).toBe(first)

    store.setSyncState(store.beginGeneration('s1', 'live'), { syncing: true })
    expect(store.getVisibleItems('s1', 'live', allVisible)).toBe(first)

    replace(store, [item('new')])
    expect(store.getVisibleItems('s1', 'live', allVisible)).not.toBe(first)
  })

  it('recomputes when the hidden set changes', () => {
    const store = loaded()
    const first = store.getVisibleItems('s1', 'live', allVisible)
    const next = store.getVisibleItems('s1', 'live', { ...allVisible, hiddenCategoryIds: new Set(['c-clean']) })
    expect(next).not.toBe(first)
    expect(ids(next)).not.toContain('clean')
  })

  it('searches the normalized name, and the group where asked', () => {
    const list = [
      m3uEntryToRecord({ id: 'x', name: 'İZMİR Haber', streamUrl: 'http://h/x', sourceId: 's1', type: 'live' }),
      m3uEntryToRecord({ id: 'y', name: 'Kanal', group: 'Izmir Yerel', streamUrl: 'http://h/y', sourceId: 's1', type: 'live' })
    ]
    expect(ids(filterBySearch(list, 'izmir'))).toEqual(['x'])
    expect(ids(filterBySearch(list, 'IZMIR', { includeGroup: true }))).toEqual(['x', 'y'])
    expect(filterBySearch(list, '')).toBe(list)
  })

  it('searches every source with clean matches before adult ones', () => {
    const store = createCatalogStore()
    replace(store, [item('match adult', { isAdult: true, searchName: 'match adult' })], 'live', 'a')
    replace(store, [item('match clean', { sourceId: 'b', type: 'vod', searchName: 'match clean' })], 'vod', 'b')

    expect(ids(searchCatalog(store, 'match', allVisible, 10))).toEqual(['match clean', 'match adult'])
    expect(ids(searchCatalog(store, 'match', { ...allVisible, showAdultContent: false }, 10))).toEqual([
      'match clean'
    ])
    expect(ids(searchCatalog(store, 'match', allVisible, 1))).toEqual(['match clean'])
  })
})

describe('catalog store subscriptions', () => {
  it('notifies only the listeners of the changed slice, plus global ones', () => {
    const store = createCatalogStore()
    const live = vi.fn()
    const vod = vi.fn()
    const other = vi.fn()
    const all = vi.fn()
    store.subscribePartition('s1', 'live', live)
    store.subscribePartition('s1', 'vod', vod)
    store.subscribePartition('s2', 'vod', other)
    store.subscribe(all)

    replace(store, [item('v', { type: 'vod' })], 'vod')

    expect(vod).toHaveBeenCalledTimes(1)
    expect(vod).toHaveBeenCalledWith({ sourceId: 's1', type: 'vod' })
    expect(live).not.toHaveBeenCalled()
    expect(other).not.toHaveBeenCalled()
    expect(all).toHaveBeenCalledTimes(1)
  })

  it('stops notifying after unsubscribe', () => {
    const store = createCatalogStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribePartition('s1', 'live', listener)
    unsubscribe()
    replace(store, [item('a')])
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('catalog store at scale', () => {
  it('ingests and queries 200,000 items', () => {
    const count = 200_000
    const streams: XtreamLiveStream[] = new Array(count)
    for (let i = 0; i < count; i++) {
      streams[i] = stream(i + 1, {
        name: i % 7 === 0 ? `Türkçe Kanal ${i}` : `Channel ${i}`,
        category_id: String(i % 400)
      })
    }
    const categories = xtreamCategoriesToRecords(
      Array.from({ length: 400 }, (_, i) => ({ category_id: String(i), category_name: `Kategori ${i}`, parent_id: 0 })),
      's1',
      'live'
    )

    const timings: Record<string, number> = {}
    const time = <T>(label: string, run: () => T): T => {
      const started = performance.now()
      const result = run()
      timings[label] = Math.round(performance.now() - started)
      return result
    }

    const store = createCatalogStore()
    const records = time('convert', () => xtreamLiveToRecords(streams, 's1'))
    time('commit', () =>
      store.commit({ token: store.beginGeneration('s1', 'live'), mode: 'replace', items: records, categories })
    )
    const settings: CatalogViewSettings = { hiddenCategoryIds: new Set(['s1_live_3']), showAdultContent: false }
    const visible = time('view', () => store.getVisibleItems('s1', 'live', settings))
    time('view (cached)', () => store.getVisibleItems('s1', 'live', settings))
    const inCategory = time('category view', () => store.getVisibleItems('s1', 'live', settings, 's1_live_7'))
    const found = time('search', () => filterBySearch(visible, 'türkçe kanal 1'))
    const byId = time('lookup', () => store.getItem('s1_live_150000'))
    time('replace again', () =>
      store.commit({ token: store.beginGeneration('s1', 'live'), mode: 'replace', items: records.slice(1) })
    )

    // Logged, not asserted: the point is the order of magnitude, and a loaded
    // CI machine must not fail the suite.
    console.info('[catalog] 200k items (ms):', timings)

    expect(store.getStatus('s1', 'live')?.count).toBe(count - 1)
    expect(visible.length).toBe(count - count / 400)
    expect(inCategory.length).toBe(count / 400)
    expect(found.length).toBeGreaterThan(0)
    expect(byId?.streamId).toBe(150_000)
  })
})
