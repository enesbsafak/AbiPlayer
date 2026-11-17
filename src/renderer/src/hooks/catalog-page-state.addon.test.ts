import { describe, expect, it } from 'vitest'
import type { AddonCategoryPaging } from '@/addons/catalog'
import type { CatalogSyncError } from '@/catalog/types'
import {
  addonPagerView,
  buildCatalogRouteState,
  effectiveAddonCategoryId,
  parseCatalogRouteState,
  type AddonPagerViewInput
} from './catalog-page-state'

const FAILED: CatalogSyncError = { kind: 'network', message: 'Sunucuya ulaşılamadı.', retryable: true }

function paging(overrides: Partial<AddonCategoryPaging> = {}): AddonCategoryPaging {
  return { pages: 0, nextSkip: 0, ended: false, loading: false, error: null, ...overrides }
}

function view(overrides: Partial<AddonPagerViewInput> = {}) {
  return addonPagerView({
    isAddon: true,
    addressLoaded: true,
    categoriesLoaded: true,
    hasCategory: true,
    paging: null,
    searching: false,
    sourceFailed: false,
    ...overrides
  })
}

describe('the category an add-on page shows', () => {
  const visible = [{ id: 'ek_vod_populer' }, { id: 'ek_vod_yeni' }]

  it('is the one picked while it is listed, else the first: an add-on has no "all"', () => {
    expect(effectiveAddonCategoryId('ek_vod_yeni', visible)).toBe('ek_vod_yeni')
    expect(effectiveAddonCategoryId(null, visible)).toBe('ek_vod_populer')
    // Hidden since it was picked.
    expect(effectiveAddonCategoryId('ek_vod_gizli', visible)).toBe('ek_vod_populer')
    expect(effectiveAddonCategoryId(null, [])).toBeNull()
  })
})

describe('add-on paging on a catalog page', () => {
  it('is nothing for other sources and for a source that cannot load', () => {
    expect(view({ isAddon: false }).firstPageLoading).toBe(false)
    expect(view({ sourceFailed: true, paging: paging({ loading: true }) })).toMatchObject({
      firstPageLoading: false,
      started: false
    })
  })

  it('waits for the categories, then for the first page, never for a page nobody asks for', () => {
    expect(view({ hasCategory: false, categoriesLoaded: false }).firstPageLoading).toBe(true)
    // Its categories are in and it has none of this type.
    expect(view({ hasCategory: false }).firstPageLoading).toBe(false)
    expect(view({ paging: null }).firstPageLoading).toBe(true)
    expect(view({ paging: paging({ loading: true }) }).firstPageLoading).toBe(true)
  })

  it('reports a failed first page for the banner, and a failed later page for under the grid', () => {
    expect(view({ paging: paging({ error: FAILED }) })).toMatchObject({ firstPageLoading: false, firstPageError: FAILED, started: false })
    expect(view({ paging: paging({ pages: 2, error: FAILED }) })).toMatchObject({
      started: true,
      firstPageError: null,
      laterPageError: FAILED,
      canLoadMore: false
    })
  })

  it('asks for the next page near the end only while nothing runs, nothing failed, the catalogue goes on and no query filters', () => {
    expect(view({ paging: paging({ pages: 1 }) }).canLoadMore).toBe(true)
    expect(view({ paging: paging({ pages: 1, loading: true }) })).toMatchObject({ canLoadMore: false, loadingMore: true })
    expect(view({ paging: paging({ pages: 3, ended: true }) })).toMatchObject({ canLoadMore: false, ended: true })
    expect(view({ paging: paging({ pages: 1 }), searching: true }).canLoadMore).toBe(false)
  })
})

describe('an add-on detail in the route state', () => {
  it('comes back with its meta id, for a film and for a series', () => {
    const detail = { itemId: 'ek_series_yeni/tt0000002', sourceId: 'ek', addonMetaId: 'tt0000002', season: 0 }
    const state = buildCatalogRouteState({ searchQuery: '', scrollTop: 0, focusItemId: null, detail })
    expect(parseCatalogRouteState(state, 'series')?.detail).toEqual(detail)
    expect(parseCatalogRouteState({ restoreDetail: { itemId: 'f', sourceId: 'ek', addonMetaId: 'tt1' } }, 'vod')?.detail).toEqual({
      itemId: 'f',
      sourceId: 'ek',
      addonMetaId: 'tt1'
    })
  })

  it('drops a meta id that is not one, and a series detail with neither id', () => {
    expect(parseCatalogRouteState({ restoreDetail: { itemId: 's', sourceId: 'ek', addonMetaId: 'a\u0000b' } }, 'series')).toBeNull()
  })
})
