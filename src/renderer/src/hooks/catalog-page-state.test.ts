import { describe, expect, it } from 'vitest'
import type { CatalogStatus } from '@/catalog/types'
import {
  buildCatalogRouteState,
  catalogBanner,
  offlineCopyBannerText,
  parseCatalogRouteState,
  providerCategoryId,
  type CatalogBannerInput
} from './catalog-page-state'

function status(patch: Partial<CatalogStatus> = {}): CatalogStatus {
  return {
    sourceId: 's1',
    type: 'vod',
    version: 1,
    count: 30,
    loaded: true,
    complete: false,
    categoriesLoaded: true,
    syncing: false,
    error: null,
    ...patch
  }
}

const base: CatalogBannerInput = { isXtream: true, hasCategory: false, categoryLoaded: false, status: status(), loadError: null }

describe('catalogBanner', () => {
  it('shows the partial-list banner while the full list loads', () => {
    expect(catalogBanner({ ...base, status: status({ syncing: true }) })).toEqual({ kind: 'partial', syncing: true })
    expect(catalogBanner({ ...base, status: null })).toEqual({ kind: 'partial', syncing: false })
  })

  it('replaces the calm banner with the error once the full sync failed (F1-26)', () => {
    const failed = status({ error: { kind: 'http', status: 500, message: 'Sunucu hatası (500)', retryable: true } })
    expect(catalogBanner({ ...base, status: failed })).toEqual({
      kind: 'sync-error',
      message: 'Sunucu hatası (500)',
      retryable: true,
      partial: true
    })
  })

  it('says whether a retry can help and whether anything is shown', () => {
    const auth = status({ count: 0, error: { kind: 'auth', message: 'Giriş reddedildi', retryable: false } })
    expect(catalogBanner({ ...base, status: auth })).toMatchObject({ kind: 'sync-error', retryable: false, partial: false })
  })

  it('says that a cached copy is shown while its refresh fails or the source cannot connect (C2c follow-up)', () => {
    const fetchedAt = Date.UTC(2026, 10, 14, 18, 30)
    const cached = status({ complete: true, fromCache: true, fetchedAt })
    const failedRefresh = { ...cached, error: { kind: 'network' as const, message: 'Ağ', retryable: true } }
    expect(catalogBanner({ ...base, status: failedRefresh })).toEqual({ kind: 'offline', since: fetchedAt, retryable: true })
    const refused = { ...cached, error: { kind: 'auth' as const, message: 'Giriş reddedildi', retryable: false } }
    expect(catalogBanner({ ...base, status: refused })).toMatchObject({ kind: 'offline', retryable: false })
    // An M3U source whose playlist could not be fetched again.
    expect(catalogBanner({ ...base, isXtream: false, status: cached, connectionFailed: true })).toMatchObject({ kind: 'offline' })
    // Still refreshing, nothing failed: no banner.
    expect(catalogBanner({ ...base, status: cached })).toBeNull()
    expect(offlineCopyBannerText(fetchedAt)).toMatch(/^Çevrimdışı kopya, .+ tarihinde güncellendi$/)
  })

  it('shows why a source without its secret shows nothing, instead of a preview that never comes (K11)', () => {
    expect(catalogBanner({ ...base, status: null, sourceError: 'Kayıtlı kullanıcı adı ve şifre bulunamadı.' })).toEqual({
      kind: 'source-error',
      message: 'Kayıtlı kullanıcı adı ve şifre bulunamadı.'
    })
  })

  it('puts a failed foreground load first', () => {
    const failed = status({ error: { kind: 'network', message: 'Ağ', retryable: true } })
    expect(catalogBanner({ ...base, status: failed, loadError: 'Filmler yüklenemedi' })).toEqual({
      kind: 'load-error',
      message: 'Filmler yüklenemedi'
    })
  })

  it('shows nothing for a complete list, an M3U source or a loaded category', () => {
    expect(catalogBanner({ ...base, status: status({ complete: true }) })).toBeNull()
    expect(catalogBanner({ ...base, isXtream: false, status: null })).toBeNull()
    const failed = status({ error: { kind: 'network', message: 'Ağ', retryable: true } })
    expect(catalogBanner({ ...base, hasCategory: true, categoryLoaded: true, status: failed })).toBeNull()
  })

  it('keeps the sync error for a category that is not loaded, without the partial banner', () => {
    const failed = status({ error: { kind: 'network', message: 'Ağ', retryable: true } })
    expect(catalogBanner({ ...base, hasCategory: true, status: failed })?.kind).toBe('sync-error')
    expect(catalogBanner({ ...base, hasCategory: true, status: status({ syncing: true }) })).toBeNull()
  })
})

describe('catalog route state', () => {
  it('round-trips what a page hands the player', () => {
    const state = buildCatalogRouteState({
      searchQuery: 'kayıp',
      scrollTop: 812.4,
      focusItemId: 's1_vod_7',
      detail: { itemId: 's1_vod_7', sourceId: 's1' }
    })
    expect(parseCatalogRouteState(state, 'vod')).toEqual({
      searchQuery: 'kayıp',
      scrollTop: 812,
      focusItemId: 's1_vod_7',
      detail: { itemId: 's1_vod_7', sourceId: 's1' }
    })
  })

  it('reads the series other screens open, with its season', () => {
    expect(
      parseCatalogRouteState({ restoreSelectedSeries: { seriesId: 42, sourceId: 'src', seasonNumber: 2 } }, 'series')
    ).toEqual({ detail: { itemId: 'src_series_42', sourceId: 'src', seriesId: 42, season: 2 } })
  })

  it('no longer reads the legacy film id, which no screen sends (K14)', () => {
    expect(parseCatalogRouteState({ restoreSelectedVODId: 's1_vod_9' }, 'vod')).toBeNull()
  })

  it('ignores what does not belong to the page or is malformed', () => {
    expect(parseCatalogRouteState(null, 'live')).toBeNull()
    expect(parseCatalogRouteState({ unrelated: true }, 'live')).toBeNull()
    expect(parseCatalogRouteState({ restoreSelectedSeries: { seriesId: 1, sourceId: 's' } }, 'vod')).toBeNull()
    expect(parseCatalogRouteState({ restoreScrollTop: -5, restoreSearchQuery: 3 }, 'live')).toBeNull()
    // A series detail without its provider id cannot be opened.
    expect(parseCatalogRouteState({ restoreDetail: { itemId: 'x', sourceId: 's' } }, 'series')).toBeNull()
  })
})

describe('providerCategoryId', () => {
  it('strips the source and type prefix of Xtream category ids', () => {
    expect(providerCategoryId('s1', 'live', 's1_live_12')).toBe('12')
    expect(providerCategoryId('s1', 'vod', 's1_live_12')).toBeNull()
    expect(providerCategoryId(null, 'live', 's1_live_12')).toBeNull()
    expect(providerCategoryId('s1', 'live', null)).toBeNull()
  })
})
