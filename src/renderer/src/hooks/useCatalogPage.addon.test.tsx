import type { ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import { catalog } from '@/catalog'
import { addonCatalogPager } from '@/addons/pager'
import { commitAddonCategories } from '@/addons/catalog'
import { addonResourceUrl } from '@/addons/address'
import { CATALOG_BASE, SECRET_SEGMENT, catalogSource, jsonResponse, metas, routeFetch } from '@/addons/testing/fixtures'
import { errors } from '@/strings/errors'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { useCatalogPage } from './useCatalogPage'

const MESSAGES = { previewLoading: 'Ön izleme yükleniyor', loadFailed: 'Yüklenemedi' }
const FIRST_PAGE = addonResourceUrl(CATALOG_BASE, 'catalog', 'movie', 'populer')
const SECOND_PAGE = addonResourceUrl(CATALOG_BASE, 'catalog', 'movie', 'populer', [['skip', 50]])

/** The fixture add-on without its search catalogue: its box can only filter what is loaded. */
function sourceWithoutSearch() {
  const source = catalogSource()
  return { ...source, addon: { ...source.addon!, catalogs: source.addon!.catalogs.filter((entry) => entry.id !== 'ara') } }
}

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/vod']}>{children}</MemoryRouter>
}

beforeEach(() => {
  catalog.reset()
  addonCatalogPager.reset()
  const source = catalogSource()
  useStore.setState({
    credentialsHydrated: true,
    sourceErrors: {},
    sources: [source],
    activeSourceId: source.id,
    selectedCategoryIds: {},
    hiddenCategoryIds: new Set(),
    settings: { ...DEFAULT_SETTINGS, showAdultContent: false }
  })
  // What connecting the add-on does: its catalogues become the categories.
  commitAddonCategories(source)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  addonCatalogPager.reset()
  catalog.reset()
  useStore.setState({ sources: [], activeSourceId: null, selectedCategoryIds: {}, settings: DEFAULT_SETTINGS })
})

describe('an add-on as the source of the Filmler page', () => {
  it('opens its first catalogue (no "all"), loads it page by page and stops at the end', async () => {
    const fetch = routeFetch({
      [FIRST_PAGE]: () => jsonResponse({ metas: metas('tt', 1, 50) }),
      [SECOND_PAGE]: () => jsonResponse({ metas: metas('tt', 51, 10) })
    })
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper })

    expect(result.current.isAddon).toBe(true)
    // The search catalogue needs a query the app does not send: not a category.
    expect(result.current.selectedCategoryId).toBe('ek_vod_populer')
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.items).toHaveLength(50))
    expect(result.current.loading).toBe(false)
    expect(result.current.banner).toBeNull()
    expect(result.current.pager).toMatchObject({ canLoadMore: true, ended: false, loadingMore: false })

    act(() => result.current.pager?.loadMore())
    await waitFor(() => expect(result.current.items).toHaveLength(60))
    expect(result.current.pager).toMatchObject({ ended: true, canLoadMore: false })
    expect(fetch.calls).toEqual([FIRST_PAGE, SECOND_PAGE])
  })

  it('does not load more by scrolling while a query filters what is loaded', async () => {
    useStore.setState({ sources: [sourceWithoutSearch()] })
    vi.stubGlobal('fetch', routeFetch({ [FIRST_PAGE]: () => jsonResponse({ metas: metas('tt', 1, 50) }) }))
    const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper })
    await waitFor(() => expect(result.current.items).toHaveLength(50))

    act(() => result.current.setSearchQuery('Örnek 1'))
    await waitFor(() => expect(result.current.appliedQuery).toBe('Örnek 1'))
    expect(result.current.searchesRemotely).toBe(false)
    expect(result.current.pager?.canLoadMore).toBe(false)
    expect(result.current.loadedCount).toBe(50)
  })

  it('asks the add-on when it has a search catalogue for the type, instead of filtering what is loaded', async () => {
    const search = addonResourceUrl(CATALOG_BASE, 'catalog', 'movie', 'ara', [['search', 'deniz']])
    const fetch = routeFetch({
      [FIRST_PAGE]: () => jsonResponse({ metas: metas('tt', 1, 50) }),
      [search]: () => jsonResponse({ metas: metas('tt', 900, 3) })
    })
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper })
    await waitFor(() => expect(result.current.items).toHaveLength(50))

    act(() => result.current.setSearchQuery('deniz'))
    expect(result.current.searchesRemotely).toBe(true)
    await waitFor(() => expect(result.current.items.map((item) => item.name)).toEqual(['Örnek 900', 'Örnek 901', 'Örnek 902']))
    expect(result.current.matchCount).toBe(3)
    expect(result.current.searchStatus).toBeNull()
    // The search catalogue has no `skip`: its one page is all there is.
    expect(result.current.pager).toMatchObject({ ended: true, canLoadMore: false })
    expect(fetch.calls.filter((url) => url === search)).toHaveLength(1)

    // Clearing the box shows the category again, without asking anything.
    act(() => result.current.setSearchQuery(''))
    await waitFor(() => expect(result.current.items).toHaveLength(50))
    expect(result.current.searchesRemotely).toBe(false)
  })

  it('words a refused first page for an add-on, without its address, and retries it', async () => {
    let refuse = true
    vi.stubGlobal(
      'fetch',
      routeFetch({
        [FIRST_PAGE]: () => (refuse ? new Response('', { status: 401 }) : jsonResponse({ metas: metas('tt', 1, 3) }))
      })
    )
    const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper })

    await waitFor(() => expect(result.current.banner?.kind).toBe('load-error'))
    const banner = result.current.banner
    expect(banner?.kind === 'load-error' ? banner.message : '').toBe(errors.addonRefused)
    expect(JSON.stringify(banner)).not.toContain(SECRET_SEGMENT)
    expect(result.current.loading).toBe(false)

    refuse = false
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.items).toHaveLength(3))
    expect(result.current.banner).toBeNull()
  })

  it('says the source cannot load when the add-on address is missing, instead of spinning', () => {
    useStore.setState({ sources: [catalogSource({ url: undefined })] })
    const { result } = renderHook(() => useCatalogPage('vod', MESSAGES), { wrapper })
    expect(result.current.loading).toBe(false)
    expect(result.current.banner?.kind).toBe('source-error')
  })
})
