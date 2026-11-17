import { describe, expect, it, vi } from 'vitest'
import { createCatalogStore } from '@/catalog/catalog-store'
import { XtreamRequestError } from '@/services/xtream-errors'
import type { PlaylistSource } from '@/types/playlist'
import { targetFromCatalogItem } from '../../../shared/playback'
import {
  addonCategoriesFor,
  addonCategoryId,
  addonItemId,
  commitAddonCategories,
  createAddonCatalogPager,
  MAX_ADDON_CATEGORY_ITEMS,
  metaPreviewToItem
} from './catalog'
import { parseCatalogPage, type AddonCatalogPage } from './client'
import { summarizeManifest } from './manifest'
import { CATALOG_BASE, CATALOG_MANIFEST, SECRET_SEGMENT, catalogSource, metas } from './testing/fixtures'
import { defined } from '../../../shared/checked'

const VIEW = { hiddenCategoryIds: new Set<string>(), showAdultContent: false }
const FILMS = addonCategoryId('ek', 'vod', 'populer')

/** A page of `count` previews from `tt<from>`; `received` is what the add-on sent before validation. */
function page(from: number, count: number, received = count): AddonCatalogPage {
  return { ...defined(parseCatalogPage({ metas: metas('tt', from, count) })), received }
}

function setup(source: PlaylistSource = catalogSource(), pages: Record<number, AddonCatalogPage | Error> = {}) {
  const store = createCatalogStore()
  const asked: number[] = []
  const fetchPage = vi.fn(async (base: string, _catalog: unknown, skip: number) => {
    expect(base).toBe(CATALOG_BASE)
    asked.push(skip)
    const answer = pages[skip]
    if (!answer) return { metas: [], received: 0 }
    if (answer instanceof Error) throw answer
    return answer
  })
  let current: PlaylistSource | undefined = source
  const pager = createAddonCatalogPager({ store, getSource: () => current, fetchPage })
  return { store, pager, asked, fetchPage, setSource: (next: PlaylistSource | undefined) => (current = next) }
}

describe('add-on catalogues as categories', () => {
  it('maps film catalogues to vod and series catalogues to series, other types and required extras left out', () => {
    const summary = defined(summarizeManifest(CATALOG_MANIFEST))
    expect(addonCategoriesFor('ek', summary, 'vod')).toEqual([
      { id: 'ek_vod_populer', name: 'Popüler Filmler', sourceId: 'ek', type: 'vod', isAdult: false }
    ])
    expect(addonCategoriesFor('ek', summary, 'series').map((category) => category.id)).toEqual(['ek_series_yeni'])
    expect(addonCategoriesFor('ek', summary, 'live')).toEqual([])
    expect(addonCategoriesFor('ek', { ...summary, adult: true }, 'vod')[0]?.isAdult).toBe(true)
  })

  it('commits the categories of both pages without items', () => {
    const store = createCatalogStore()
    commitAddonCategories(catalogSource(), store)
    expect(store.getCategories('ek', 'vod').map((category) => category.name)).toEqual(['Popüler Filmler'])
    expect(store.getCategories('ek', 'series').map((category) => category.name)).toEqual(['Yeni Diziler'])
    expect(store.getStatus('ek', 'vod')).toMatchObject({ categoriesLoaded: true, loaded: false, complete: false })
  })

  it('makes a meta preview a card with ids in the source’s scheme and no URL', () => {
    const preview = defined(defined(parseCatalogPage({ metas: metas('tt', 7, 1) })).metas[0])
    const item = metaPreviewToItem(preview, { sourceId: 'ek', type: 'vod', catalog: { id: 'populer', name: 'Popüler Filmler' }, adult: false })
    expect(item).toMatchObject({
      id: addonItemId('ek', 'vod', 'populer', 'tt7'),
      name: 'Örnek 7',
      streamUrl: '',
      sourceId: 'ek',
      type: 'vod',
      addonMetaId: 'tt7',
      categoryId: 'ek_vod_populer',
      categoryName: 'Popüler Filmler',
      year: '2021',
      rating: '7.1',
      coverUrl: 'https://img.addon.example/7.jpg',
      searchName: 'örnek 7',
      isAdult: false
    })
    expect(item.id.startsWith('ek_vod_')).toBe(true)
    expect(targetFromCatalogItem(item)).toMatchObject({ kind: 'addon', contentType: 'movie', metaId: 'tt7', videoId: 'tt7' })
    // Ids with odd characters stay apart.
    expect(addonItemId('ek', 'vod', 'a/b', 'c')).not.toBe(addonItemId('ek', 'vod', 'a', 'b/c'))
  })
})

describe('paging a category', () => {
  it('loads the first page once, appends the next ones in order and stops at a short page', async () => {
    const { store, pager, asked } = setup(catalogSource(), { 0: page(1, 3), 3: page(4, 3), 6: page(7, 1) })
    await pager.loadFirstPage('ek', 'vod', FILMS)
    await pager.loadFirstPage('ek', 'vod', FILMS)
    expect(asked).toEqual([0])
    expect(store.isCategoryLoaded('ek', 'vod', FILMS)).toBe(false)
    expect(pager.getPaging('ek', 'vod', FILMS)).toEqual({ pages: 1, nextSkip: 3, ended: false, loading: false, error: null })

    await pager.loadNextPage('ek', 'vod', FILMS)
    await pager.loadNextPage('ek', 'vod', FILMS)
    expect(asked).toEqual([0, 3, 6])
    expect(pager.getPaging('ek', 'vod', FILMS)).toMatchObject({ pages: 3, nextSkip: 7, ended: true })
    expect(store.isCategoryLoaded('ek', 'vod', FILMS)).toBe(true)
    expect(store.getVisibleItems('ek', 'vod', VIEW, FILMS).map((item) => item.name)).toEqual([
      'Örnek 1', 'Örnek 2', 'Örnek 3', 'Örnek 4', 'Örnek 5', 'Örnek 6', 'Örnek 7'
    ])

    await pager.loadNextPage('ek', 'vod', FILMS)
    expect(asked).toEqual([0, 3, 6])
  })

  it('ends on an empty page and on a page with nothing new (an add-on that ignores skip)', async () => {
    const empty = setup(catalogSource(), { 0: page(1, 2) })
    await empty.pager.loadFirstPage('ek', 'vod', FILMS)
    await empty.pager.loadNextPage('ek', 'vod', FILMS)
    expect(empty.pager.getPaging('ek', 'vod', FILMS)).toMatchObject({ ended: true, pages: 2 })

    const repeating = setup(catalogSource(), { 0: page(1, 2), 2: page(1, 2) })
    await repeating.pager.loadFirstPage('ek', 'vod', FILMS)
    await repeating.pager.loadNextPage('ek', 'vod', FILMS)
    expect(repeating.pager.getPaging('ek', 'vod', FILMS)).toMatchObject({ ended: true })
    expect(repeating.store.getCategoryItems('ek', 'vod', FILMS)).toHaveLength(2)
  })

  it('advances skip by what the add-on sent, valid or not', async () => {
    const { pager, asked } = setup(catalogSource(), { 0: page(1, 2, 3), 3: page(3, 2, 3) })
    await pager.loadFirstPage('ek', 'vod', FILMS)
    await pager.loadNextPage('ek', 'vod', FILMS)
    expect(asked).toEqual([0, 3])
  })

  it('stops after the first page when the catalogue does not page', async () => {
    const source = catalogSource()
    const summary = defined(source.addon)
    const noSkip = { ...source, addon: { ...summary, catalogs: summary.catalogs.map((entry) => ({ ...entry, extra: [] })) } }
    const { pager, store } = setup(noSkip, { 0: page(1, 3) })
    await pager.loadFirstPage('ek', 'vod', FILMS)
    expect(pager.getPaging('ek', 'vod', FILMS)).toMatchObject({ ended: true })
    expect(store.isCategoryLoaded('ek', 'vod', FILMS)).toBe(true)
  })

  it('caps a category', async () => {
    const big = defined(parseCatalogPage({ metas: metas('tt', 1, 500) }))
    const pages: Record<number, AddonCatalogPage> = {}
    for (let skip = 0; skip < MAX_ADDON_CATEGORY_ITEMS + 1000; skip += 500) {
      pages[skip] = { ...defined(parseCatalogPage({ metas: metas('tt', skip + 1, 500) })), received: big.received }
    }
    const { pager, store } = setup(catalogSource(), pages)
    await pager.loadFirstPage('ek', 'vod', FILMS)
    for (let i = 0; i < 20; i++) await pager.loadNextPage('ek', 'vod', FILMS)
    expect(store.getCategoryItems('ek', 'vod', FILMS)).toHaveLength(MAX_ADDON_CATEGORY_ITEMS)
    expect(pager.getPaging('ek', 'vod', FILMS)?.ended).toBe(true)
  })

  it('records a failure as a catalog error without the address, and retries the same page', async () => {
    const pages: Record<number, AddonCatalogPage | Error> = { 0: new XtreamRequestError('http', 'Sunucu isteği reddetti (HTTP 500).', { status: 500, host: 'addon.example' }) }
    const { pager, asked } = setup(catalogSource(), pages)
    await pager.loadFirstPage('ek', 'vod', FILMS)
    const failed = pager.getPaging('ek', 'vod', FILMS)
    expect(failed).toMatchObject({ pages: 0, loading: false, error: { kind: 'http', status: 500, retryable: true } })
    expect(JSON.stringify(failed)).not.toContain(SECRET_SEGMENT)

    pages[0] = page(1, 2)
    await pager.retry('ek', 'vod', FILMS)
    expect(asked).toEqual([0, 0])
    expect(pager.getPaging('ek', 'vod', FILMS)).toMatchObject({ pages: 1, error: null })
  })

  it('notifies subscribers with stable snapshots', async () => {
    const { pager } = setup(catalogSource(), { 0: page(1, 2) })
    const listener = vi.fn()
    const unsubscribe = pager.subscribe(listener)
    await pager.loadFirstPage('ek', 'vod', FILMS)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(pager.getPaging('ek', 'vod', FILMS)).toBe(pager.getPaging('ek', 'vod', FILMS))
    unsubscribe()
  })

  it('drops what arrives after the source was removed, and starts over after a refresh', async () => {
    let release: (value: AddonCatalogPage) => void = () => undefined
    const store = createCatalogStore()
    const pager = createAddonCatalogPager({
      store,
      getSource: () => catalogSource(),
      fetchPage: () => new Promise<AddonCatalogPage>((resolve) => (release = resolve))
    })
    const loading = pager.loadFirstPage('ek', 'vod', FILMS)
    expect(pager.getPaging('ek', 'vod', FILMS)?.loading).toBe(true)
    store.removeSource('ek')
    release(page(1, 2))
    await loading
    expect(store.getItems('ek', 'vod')).toHaveLength(0)
    expect(pager.getPaging('ek', 'vod', FILMS)).toBeNull()
  })

  it('asks nothing without the address or for a category the add-on does not have', async () => {
    const { pager, fetchPage } = setup(catalogSource({ url: undefined }))
    await pager.loadFirstPage('ek', 'vod', FILMS)
    await pager.loadFirstPage('ek', 'vod', 'ek_vod_baska')
    expect(fetchPage).not.toHaveBeenCalled()
    expect(pager.getPaging('ek', 'vod', FILMS)).toBeNull()
  })

  it('forgets a source’s paging on reset', async () => {
    const { pager } = setup(catalogSource(), { 0: page(1, 2) })
    await pager.loadFirstPage('ek', 'vod', FILMS)
    pager.reset('ek')
    expect(pager.getPaging('ek', 'vod', FILMS)).toBeNull()
  })
})
