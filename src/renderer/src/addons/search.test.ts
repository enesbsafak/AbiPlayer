import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogItem } from '@/catalog/types'
import { tmdbCatalogSourceFor } from './builtin'
import type { AddonCatalogPage } from './client'
import { searchCatalogFor } from './manifest'
import type { AddonCatalogProvider } from './provider'
import { EMPTY_ADDON_SEARCH, MAX_ADDON_SEARCH_RESULTS, addonSearchReducer, useAddonSearch, type AddonSearchTarget } from './search'
import { tmdbCatalogSummary } from './tmdb'

function item(id: string): CatalogItem {
  return { id, name: id, streamUrl: '', sourceId: 's', type: 'vod', searchName: id, isAdult: false }
}

function page(received: number, extra: Partial<AddonCatalogPage> = {}): AddonCatalogPage {
  return { metas: [], received, ...extra }
}

describe('the search state', () => {
  it('starts over for another query and appends the pages of the same one', () => {
    let state = addonSearchReducer(EMPTY_ADDON_SEARCH, { type: 'loading', query: 'deniz' })
    expect(state).toMatchObject({ query: 'deniz', loading: true, items: [] })
    state = addonSearchReducer(state, {
      type: 'page',
      query: 'deniz',
      skip: 0,
      items: [item('a'), item('b')],
      page: page(20, { total: 41 }),
      pageable: true
    })
    expect(state).toMatchObject({ pages: 1, nextSkip: 20, total: 41, ended: false, loading: false })
    state = addonSearchReducer(state, { type: 'loading', query: 'deniz' })
    state = addonSearchReducer(state, { type: 'page', query: 'deniz', skip: 20, items: [item('b'), item('c')], page: page(20), pageable: true })
    expect(state.items.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(state.nextSkip).toBe(40)

    state = addonSearchReducer(state, { type: 'loading', query: 'fener' })
    expect(state).toMatchObject({ query: 'fener', items: [], pages: 0, nextSkip: 0, total: null })
  })

  it('ignores an answer for another query or a page already in', () => {
    const asked = addonSearchReducer(EMPTY_ADDON_SEARCH, { type: 'loading', query: 'yeni' })
    expect(addonSearchReducer(asked, { type: 'page', query: 'eski', skip: 0, items: [item('x')], page: page(20), pageable: true })).toBe(asked)
    expect(addonSearchReducer(asked, { type: 'page', query: 'yeni', skip: 20, items: [item('x')], page: page(20), pageable: true })).toBe(asked)
    expect(addonSearchReducer(asked, { type: 'failed', query: 'eski', error: { kind: 'network', message: 'x', retryable: true } })).toBe(asked)
  })

  it('ends with the last page, an empty one, a catalogue without paging, a page of repeats or the cap', () => {
    const first = (extra: Partial<AddonCatalogPage>, pageable = true) =>
      addonSearchReducer(addonSearchReducer(EMPTY_ADDON_SEARCH, { type: 'loading', query: 'q' }), {
        type: 'page',
        query: 'q',
        skip: 0,
        items: [item('a')],
        page: page(20, extra),
        pageable
      })
    expect(first({ ended: true }).ended).toBe(true)
    expect(first({ received: 0 }).ended).toBe(true)
    expect(first({}, false).ended).toBe(true)
    expect(first({}).ended).toBe(false)

    const repeated = addonSearchReducer(first({}), { type: 'page', query: 'q', skip: 20, items: [item('a')], page: page(20), pageable: true })
    expect(repeated.ended).toBe(true)

    const many = Array.from({ length: MAX_ADDON_SEARCH_RESULTS + 5 }, (_, index) => item(`i${index}`))
    const capped = addonSearchReducer(addonSearchReducer(EMPTY_ADDON_SEARCH, { type: 'loading', query: 'q' }), {
      type: 'page',
      query: 'q',
      skip: 0,
      items: many,
      page: page(20),
      pageable: true
    })
    expect(capped.items).toHaveLength(MAX_ADDON_SEARCH_RESULTS)
    expect(capped.ended).toBe(true)
  })

  it('keeps what it has when a page fails, and clears', () => {
    let state = addonSearchReducer(EMPTY_ADDON_SEARCH, { type: 'loading', query: 'q' })
    state = addonSearchReducer(state, { type: 'failed', query: 'q', error: { kind: 'timeout', message: 'geç', retryable: true } })
    expect(state).toMatchObject({ loading: false, error: { kind: 'timeout' }, query: 'q' })
    expect(addonSearchReducer(state, { type: 'clear' })).toBe(EMPTY_ADDON_SEARCH)
  })
})

describe('useAddonSearch', () => {
  const source = tmdbCatalogSourceFor(tmdbCatalogSummary({ movie: [], series: [] }), 1)
  const target: AddonSearchTarget = { source, type: 'vod', catalog: searchCatalogFor(source.addon!, 'vod')! }

  function fakeProvider(answer: (search: string, skip: number, signal?: AbortSignal) => Promise<AddonCatalogPage>) {
    const catalogPage = vi.fn((_catalog, request: { skip: number; search?: string }, options: { signal?: AbortSignal }) =>
      answer(request.search ?? '', request.skip, options.signal)
    )
    const provider: AddonCatalogProvider = { catalogPage, meta: vi.fn(), seasonVideos: vi.fn() }
    return { provider, catalogPage }
  }

  function metas(prefix: string, count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `tmdb:${prefix}${index}`,
      type: 'movie',
      name: `${prefix} ${index}`,
      poster: null,
      background: null,
      year: null,
      releaseInfo: null,
      rating: null,
      description: null,
      genres: []
    }))
  }

  afterEach(() => vi.useRealTimers())

  it('asks once typing pauses, cancels the previous query, and pages on', async () => {
    const signals: AbortSignal[] = []
    const { provider, catalogPage } = fakeProvider(async (search, skip, signal) => {
      if (signal) signals.push(signal)
      return { metas: metas(`${search}${skip}-`, 2), received: 20, ended: skip >= 20, total: 4 }
    })
    const { result, rerender } = renderHook(({ query }) => useAddonSearch(target, query, () => provider, 30), {
      initialProps: { query: '' }
    })
    expect(result.current.active).toBe(false)

    rerender({ query: 'd' })
    rerender({ query: 'de' })
    rerender({ query: 'deniz' })
    expect(result.current).toMatchObject({ active: true, pending: true })
    await waitFor(() => expect(result.current.state.items).toHaveLength(2))
    // Only the query typing stopped at was asked.
    expect(catalogPage).toHaveBeenCalledTimes(1)
    expect(catalogPage.mock.calls[0]![1]).toEqual({ skip: 0, search: 'deniz' })
    expect(result.current.pending).toBe(false)
    expect(result.current.state.items[0]).toMatchObject({ addonMetaId: 'tmdb:deniz0-0', sourceId: source.id, type: 'vod' })

    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.state.items).toHaveLength(4))
    expect(result.current.state.ended).toBe(true)
    expect(catalogPage.mock.calls[1]![1]).toEqual({ skip: 20, search: 'deniz' })

    // Clearing the box: nothing shown, nothing asked.
    rerender({ query: '  ' })
    await waitFor(() => expect(result.current.state).toBe(EMPTY_ADDON_SEARCH))
    expect(result.current.active).toBe(false)
    expect(catalogPage).toHaveBeenCalledTimes(2)
  })

  it('cancels a request whose query was replaced', async () => {
    let release: (() => void) | null = null
    const signals: AbortSignal[] = []
    const { provider } = fakeProvider(
      (search, _skip, signal) =>
        new Promise((resolve) => {
          if (signal) signals.push(signal)
          if (search === 'eski') release = () => resolve({ metas: metas('eski', 1), received: 20, ended: true })
          else resolve({ metas: metas('yeni', 3), received: 20, ended: true })
        })
    )
    const { result, rerender } = renderHook(({ query }) => useAddonSearch(target, query, () => provider, 1), {
      initialProps: { query: 'eski' }
    })
    await waitFor(() => expect(signals).toHaveLength(1))
    rerender({ query: 'yeni' })
    await waitFor(() => expect(result.current.state.items).toHaveLength(3))
    expect(signals[0]!.aborted).toBe(true)
    act(() => release?.())
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(result.current.state.items.map((entry) => entry.name)).toEqual(['yeni 0', 'yeni 1', 'yeni 2'])
  })

  it('reports a failed first page and retries it', async () => {
    let fail = true
    const { provider } = fakeProvider(async () => {
      if (fail) throw Object.assign(new Error('TMDB şu an çok fazla istek alıyor.'), { kind: 'http', status: 429 })
      return { metas: metas('a', 1), received: 20, ended: true }
    })
    const { result } = renderHook(() => useAddonSearch(target, 'matris', () => provider, 1))
    await waitFor(() => expect(result.current.state.error).not.toBeNull())
    expect(result.current.state.pages).toBe(0)
    fail = false
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.state.items).toHaveLength(1))
    expect(result.current.state.error).toBeNull()
  })

  it('is off without a search target', () => {
    const { result } = renderHook(() => useAddonSearch(null, 'deniz', () => null, 1))
    expect(result.current.active).toBe(false)
  })
})
