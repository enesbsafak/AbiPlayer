import type { ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sync = vi.hoisted(() => ({
  ensureFullSync: vi.fn(() => Promise.resolve()),
  ensureStagedSync: vi.fn(() => Promise.resolve())
}))
vi.mock('@/services/background-sync', () => sync)

const xtream = vi.hoisted(() => ({
  getVodCategories: vi.fn(),
  getVodStreams: vi.fn(),
  getVodPreviewStreams: vi.fn()
}))
vi.mock('@/services/xtream-api', () => ({ xtreamApi: xtream }))

import { useStore } from '@/store'
import { catalog, categoryToRecord, m3uEntryToRecord, type CatalogType } from '@/catalog'
import { DEFAULT_SETTINGS } from '@/types/settings'
import type { PlaylistSource } from '@/types/playlist'
import { useCatalogPage } from './useCatalogPage'

const MESSAGES = { previewLoading: 'Ön izleme yükleniyor', loadFailed: 'Yüklenemedi' }
const creds = { url: 'http://panel.test', username: 'u', password: 'p' }

function source(type: 'm3u' | 'xtream'): PlaylistSource {
  return { id: 's1', name: 'Kaynak', type, addedAt: 1 } as PlaylistSource
}

function commitItems(type: CatalogType, names: string[], categoryId = `s1_${type}_1`, mode: 'replace' | 'partial' = 'replace') {
  catalog.commit({
    token: catalog.beginGeneration('s1', type),
    mode,
    items: names.map((name, index) =>
      m3uEntryToRecord({ id: `s1_${type}_${index}`, name, streamUrl: `http://cdn.test/${type}/${index}`, sourceId: 's1', type, categoryId })
    ),
    categories: [categoryToRecord({ id: categoryId, name: 'Kategori', sourceId: 's1', type })]
  })
}

function router(initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/vod']) {
  return ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
}

beforeEach(() => {
  catalog.reset()
  sync.ensureFullSync.mockClear()
  sync.ensureStagedSync.mockClear()
  xtream.getVodCategories.mockReset()
  xtream.getVodStreams.mockReset()
  useStore.setState({
    credentialsHydrated: true,
    sourceErrors: {},
    sources: [source('m3u')],
    activeSourceId: 's1',
    selectedCategoryIds: {},
    hiddenCategoryIds: new Set(),
    settings: { ...DEFAULT_SETTINGS, showAdultContent: true },
    getXtreamCredentials: () => creds
  })
})

afterEach(() => {
  cleanup()
  catalog.reset()
  useStore.setState({ sources: [], activeSourceId: null, selectedCategoryIds: {}, settings: DEFAULT_SETTINGS })
})

describe('useCatalogPage', () => {
  it('keeps the category selection per content type (F1-20)', () => {
    commitItems('live', ['TRT 1', 'Show TV'])
    commitItems('vod', ['Film A', 'Film B', 'Film C'], 's1_vod_1')
    const { result } = renderHook(
      () => ({ live: useCatalogPage('live', MESSAGES), vod: useCatalogPage('vod', MESSAGES) }),
      { wrapper: router() }
    )

    act(() => result.current.live.selectCategory('s1_live_9'))

    expect(result.current.live.selectedCategoryId).toBe('s1_live_9')
    expect(result.current.live.items).toHaveLength(0)
    expect(result.current.vod.selectedCategoryId).toBeNull()
    expect(result.current.vod.items).toHaveLength(3)
  })

  it('filters with a deferred query and reports the true match count', () => {
    const names = Array.from({ length: 1500 }, (_, i) => (i % 3 === 0 ? `Gece ${i}` : `Gündüz ${i}`))
    commitItems('vod', names)
    const renders: Array<{ query: string; applied: string }> = []
    const { result } = renderHook(
      () => {
        const page = useCatalogPage('vod', MESSAGES)
        renders.push({ query: page.searchQuery, applied: page.appliedQuery })
        return page
      },
      { wrapper: router() }
    )
    renders.length = 0

    act(() => result.current.setSearchQuery('gece'))

    // The keystroke renders first with the previous list, the filter follows.
    expect(renders[0]).toEqual({ query: 'gece', applied: '' })
    expect(renders[renders.length - 1]).toEqual({ query: 'gece', applied: 'gece' })
    expect(result.current.matchCount).toBe(500)
    expect(result.current.items).toHaveLength(500)
    expect(result.current.isSearchPending).toBe(false)
  })

  it('restores query, detail, scroll and focus from route state and clears it', async () => {
    commitItems('vod', ['Kayıp Şehir', 'Başka Film'])
    const state = {
      restoreSearchQuery: 'kayıp',
      restoreScrollTop: 640,
      restoreFocusItemId: 's1_vod_0',
      restoreDetail: { itemId: 's1_vod_0', sourceId: 's1' }
    }
    const { result } = renderHook(
      () => ({ page: useCatalogPage('vod', MESSAGES), location: useLocation() }),
      { wrapper: router([{ pathname: '/vod', state }]) }
    )

    await waitFor(() => expect(result.current.location.state).toBeNull())
    expect(result.current.page.searchQuery).toBe('kayıp')
    expect(result.current.page.detail).toEqual({ itemId: 's1_vod_0', sourceId: 's1' })
    expect(result.current.page.pendingScrollRef.current).toBe(640)
    expect(result.current.page.pendingFocusRef.current).toBe('s1_vod_0')
    expect(result.current.page.items.map((item) => item.name)).toEqual(['Kayıp Şehir'])
  })

  it('opens a series sent by another screen', async () => {
    const { result } = renderHook(() => useCatalogPage('series', MESSAGES), {
      wrapper: router([{ pathname: '/series', state: { restoreSelectedSeries: { seriesId: 42, sourceId: 's1' } } }])
    })
    await waitFor(() => expect(result.current.detail).toEqual({ itemId: 's1_series_42', sourceId: 's1', seriesId: 42 }))
  })

  it('hands the open detail and the card to focus to the player, and focuses the card again on close', () => {
    commitItems('vod', ['Film A'])
    const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper: router() })

    act(() => result.current.openDetail({ itemId: 's1_vod_0', sourceId: 's1' }))
    act(() => result.current.setSearchQuery('film'))
    expect(result.current.routeStateFor('s1_vod_0')).toEqual({
      restoreSearchQuery: 'film',
      restoreScrollTop: 0,
      restoreFocusItemId: 's1_vod_0',
      restoreDetail: { itemId: 's1_vod_0', sourceId: 's1' }
    })

    act(() => result.current.closeDetail())
    expect(result.current.detail).toBeNull()
    expect(result.current.pendingFocusRef.current).toBe('s1_vod_0')
  })

  it('drops the query and the detail when the source changes, keeping each source its own selection', () => {
    commitItems('vod', ['Film A'])
    const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper: router() })
    act(() => {
      result.current.selectCategory('s1_vod_1')
      result.current.setSearchQuery('film')
      result.current.openDetail({ itemId: 's1_vod_0', sourceId: 's1' })
    })

    act(() => {
      useStore.setState({ sources: [source('m3u'), { ...source('m3u'), id: 's2' }], activeSourceId: 's2' })
    })
    expect(result.current.searchQuery).toBe('')
    expect(result.current.detail).toBeNull()
    expect(result.current.selectedCategoryId).toBeNull()

    act(() => {
      useStore.setState({ activeSourceId: 's1' })
    })
    expect(result.current.selectedCategoryId).toBe('s1_vod_1')
  })

  describe('with an Xtream source', () => {
    beforeEach(() => {
      useStore.setState({ sources: [source('xtream')] })
      xtream.getVodCategories.mockResolvedValue([])
    })

    it('shows a failed full sync with a retry instead of the loading banner, and does not retry on its own', () => {
      commitItems('vod', ['Film A'], 's1_vod_1', 'partial')
      catalog.setSyncState(catalog.beginGeneration('s1', 'vod'), {
        syncing: false,
        error: { kind: 'http', status: 500, message: 'Sunucu hatası (500)', retryable: true }
      })
      const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper: router() })

      expect(result.current.banner).toEqual({ kind: 'sync-error', message: 'Sunucu hatası (500)', retryable: true, partial: true })
      expect(sync.ensureStagedSync).not.toHaveBeenCalled()

      act(() => result.current.retry())
      expect(sync.ensureFullSync).toHaveBeenCalledWith('s1', 'vod', creds)
    })

    it('starts the background sync after the preview and shows the partial banner meanwhile', () => {
      commitItems('vod', ['Film A'], 's1_vod_1', 'partial')
      const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper: router() })

      expect(sync.ensureStagedSync).toHaveBeenCalledWith('s1', 'vod', creds)
      expect(result.current.banner).toEqual({ kind: 'partial', syncing: false })
    })

    it('drops the load error of a category once another selection is shown (K4)', async () => {
      commitItems('vod', ['Film A'], 's1_vod_1', 'partial')
      xtream.getVodStreams.mockRejectedValueOnce(Object.assign(new Error('Sunucu hatası'), { kind: 'http', status: 500 }))
      const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper: router() })

      act(() => result.current.selectCategory('s1_vod_7'))
      await waitFor(() => expect(result.current.banner?.kind).toBe('load-error'))

      act(() => result.current.selectCategory(null))
      expect(result.current.banner).toEqual({ kind: 'partial', syncing: false })
    })

    it('does not show unfiltered cards next to "0 sonuç" while a category loads (K13)', async () => {
      // Two films of the category are known from the preview; the rest is loading.
      commitItems('vod', ['Film A', 'Film B'], 's1_vod_1', 'partial')
      xtream.getVodStreams.mockImplementation(() => new Promise(() => undefined))
      const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper: router() })
      act(() => result.current.selectCategory('s1_vod_1'))
      await waitFor(() => expect(result.current.loading).toBe(true))
      expect(result.current.items).toHaveLength(2)

      act(() => result.current.setSearchQuery('zzz'))
      await waitFor(() => expect(result.current.appliedQuery).toBe('zzz'))
      expect(result.current.matchCount).toBe(0)
      expect(result.current.items).toHaveLength(0)
    })

    it('shows why a source without its secret shows nothing, and spins nowhere (K11)', () => {
      useStore.setState({
        credentialsHydrated: true,
        getXtreamCredentials: () => null,
        sourceErrors: { s1: { kind: 'missing-secret', message: 'Kayıtlı kullanıcı adı ve şifre bulunamadı.', retryAt: null } }
      })
      const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper: router() })

      expect(result.current.banner).toEqual({ kind: 'source-error', message: 'Kayıtlı kullanıcı adı ve şifre bulunamadı.' })
      expect(result.current.categoriesLoading).toBe(false)
      expect(xtream.getVodCategories).not.toHaveBeenCalled()
    })

    it('says that a cached copy is shown when its refresh failed, and refreshes it on retry (C2c follow-up)', () => {
      const fetchedAt = Date.UTC(2026, 10, 14, 18, 30)
      catalog.commit({
        token: catalog.beginGeneration('s1', 'vod'),
        mode: 'replace',
        items: [m3uEntryToRecord({ id: 's1_vod_0', name: 'Film A', streamUrl: 'http://cdn.test/a', sourceId: 's1', type: 'vod' })],
        origin: { fromCache: true, fetchedAt }
      })
      catalog.setSyncState(catalog.beginGeneration('s1', 'vod'), {
        error: { kind: 'network', message: 'Sunucuya ulaşılamadı', retryable: true }
      })
      const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper: router() })

      expect(result.current.banner).toEqual({ kind: 'offline', since: fetchedAt, retryable: true })
      act(() => result.current.retry())
      expect(sync.ensureFullSync).toHaveBeenCalledWith('s1', 'vod', creds)
    })

    it('shows a failed category list and fetches it again on retry', async () => {
      xtream.getVodCategories.mockRejectedValueOnce(Object.assign(new Error('Sunucuya ulaşılamadı'), { kind: 'network' }))
      xtream.getVodCategories.mockResolvedValueOnce([{ category_id: '5', category_name: 'Aksiyon', parent_id: 0 }])
      catalog.commit({ token: catalog.beginGeneration('s1', 'vod'), mode: 'replace', items: [] })
      const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper: router() })

      await waitFor(() => expect(result.current.categoriesError).not.toBeNull())
      expect(result.current.categoriesLoading).toBe(false)

      act(() => result.current.retryCategories())
      await waitFor(() => expect(catalog.getCategories('s1', 'vod').map((category) => category.name)).toEqual(['Aksiyon']))
      expect(result.current.categoriesError).toBeNull()
      expect(xtream.getVodCategories).toHaveBeenCalledTimes(2)
    })
  })
})
