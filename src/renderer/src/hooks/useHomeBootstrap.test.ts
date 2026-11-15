import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/background-sync', () => ({ ensureStagedSync: vi.fn(() => Promise.resolve()) }))

import { useStore } from '@/store'
import { catalog, createCatalogStore } from '@/catalog/catalog-store'
import { xtreamApi } from '@/services/xtream-api'
import { XtreamRequestError } from '@/services/xtream-errors'
import { ensureStagedSync } from '@/services/background-sync'
import type { CatalogCategory, CatalogItem, CatalogType } from '@/catalog/types'
import type { PlaylistSource } from '@/types/playlist'
import type { XtreamAuthResponse, XtreamCategory, XtreamCredentials, XtreamLiveStream } from '@/types/xtream'
import {
  bootstrapReducer,
  orderPreviewByCategories,
  runHomeBootstrap,
  summarizeBootstrap,
  useHomeBootstrap,
  type HomeBootstrapApi
} from './useHomeBootstrap'

const CREDS: XtreamCredentials = { url: 'http://panel.test', username: 'u', password: 'p' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function item(id: string, type: CatalogType, categoryId?: string): CatalogItem {
  return {
    id,
    name: id,
    streamUrl: '',
    streamId: Number(id.replace(/\D/g, '')) || 1,
    sourceId: 's',
    type,
    searchName: id,
    isAdult: false,
    ...(categoryId ? { categoryId } : {})
  }
}

function category(id: string, type: CatalogType = 'live'): CatalogCategory {
  return { id, name: id, sourceId: 's', type, isAdult: false }
}

const xtreamCategory = (id: string): XtreamCategory => ({ category_id: id, category_name: `Kategori ${id}`, parent_id: 0 })

/** An api whose every call waits for the test to settle it. */
function controlledApi() {
  const categories = new Map<CatalogType, ReturnType<typeof deferred<XtreamCategory[]>>>()
  const previews = new Map<CatalogType, ReturnType<typeof deferred<CatalogItem[]>>>()
  for (const type of ['live', 'vod', 'series'] as const) {
    categories.set(type, deferred())
    previews.set(type, deferred())
  }
  const api: HomeBootstrapApi = {
    getCategories: vi.fn((type: CatalogType) => categories.get(type)!.promise),
    getPreview: vi.fn((type: CatalogType) => previews.get(type)!.promise)
  }
  return { api, categories, previews }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('runHomeBootstrap (F4-06)', () => {
  it('commits each type as soon as its own preview arrives, not after the slowest', async () => {
    const store = createCatalogStore()
    const { api, categories, previews } = controlledApi()
    const run = runHomeBootstrap({
      sourceId: 's',
      creds: CREDS,
      types: ['live', 'vod', 'series'],
      signal: new AbortController().signal,
      catalog: store,
      api
    })

    categories.get('live')!.resolve([xtreamCategory('1')])
    previews.get('live')!.resolve([item('s_live_1', 'live')])
    await flush()

    // Films and series are still on their way; live is already in.
    expect(store.getItems('s', 'live').map((entry) => entry.id)).toEqual(['s_live_1'])
    expect(store.getCategories('s', 'live')).toHaveLength(1)
    expect(store.getItems('s', 'vod')).toEqual([])

    categories.get('vod')!.resolve([])
    previews.get('vod')!.resolve([item('s_vod_2', 'vod')])
    categories.get('series')!.resolve([])
    previews.get('series')!.resolve([])
    const outcomes = await run

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['loaded', 'loaded', 'empty'])
    // A preview is a partial batch: the full sync still has to run.
    expect(store.getStatus('s', 'live')?.complete).toBe(false)
    expect(store.getStatus('s', 'vod')?.complete).toBe(false)
  })

  it('starts the three types together', () => {
    const { api } = controlledApi()
    void runHomeBootstrap({
      sourceId: 's',
      creds: CREDS,
      types: ['live', 'vod', 'series'],
      signal: new AbortController().signal,
      catalog: createCatalogStore(),
      api
    })
    expect(api.getCategories).toHaveBeenCalledTimes(3)
  })

  it('still tries the preview when the category list fails, and reports the failure when that fails too', async () => {
    const store = createCatalogStore()
    const api: HomeBootstrapApi = {
      getCategories: vi.fn(() => Promise.reject(new XtreamRequestError('http', 'Sunucu hata döndürdü (HTTP 500)', { status: 500 }))),
      getPreview: vi.fn((type: CatalogType) =>
        type === 'live'
          ? Promise.resolve([item('s_live_1', 'live')])
          : Promise.reject(new XtreamRequestError('http', 'Sunucu hata döndürdü (HTTP 500)', { status: 500 }))
      )
    }
    const outcomes = await runHomeBootstrap({
      sourceId: 's',
      creds: CREDS,
      types: ['live', 'vod'],
      signal: new AbortController().signal,
      catalog: store,
      api
    })
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['loaded', 'failed'])
    expect(store.getItems('s', 'live')).toHaveLength(1)
  })

  it('treats a cancelled run as cancelled, not failed, and commits nothing', async () => {
    const store = createCatalogStore()
    const controller = new AbortController()
    const { api, categories, previews } = controlledApi()
    const run = runHomeBootstrap({ sourceId: 's', creds: CREDS, types: ['live'], signal: controller.signal, catalog: store, api })
    categories.get('live')!.resolve([])
    controller.abort()
    previews.get('live')!.reject(new XtreamRequestError('aborted', 'İstek iptal edildi'))
    const outcomes = await run
    expect(outcomes).toEqual([{ type: 'live', status: 'cancelled' }])
    expect(summarizeBootstrap(outcomes)).toMatchObject({ allFailed: false, failures: [], cancelled: true })
    expect(store.getStatus('s', 'live')?.loaded ?? false).toBe(false)
  })
})

describe('summarizeBootstrap (F1-43)', () => {
  const network = new XtreamRequestError('network', 'Sunucuya bağlanılamadı.')

  it('is an error when every type failed', () => {
    const summary = summarizeBootstrap([
      { type: 'live', status: 'failed', error: network },
      { type: 'vod', status: 'failed', error: network },
      { type: 'series', status: 'failed', error: network }
    ])
    expect(summary.allFailed).toBe(true)
    expect(summary.failures[0].message).toMatch(/Sunucuya ulaşılamadı/)
  })

  it('names what did not load when only some types failed', () => {
    const summary = summarizeBootstrap([
      { type: 'live', status: 'loaded', count: 3 },
      { type: 'vod', status: 'failed', error: network },
      { type: 'series', status: 'empty' }
    ])
    expect(summary.allFailed).toBe(false)
    expect(summary.failures.map((failure) => failure.label)).toEqual(['Filmler'])
  })
})

describe('orderPreviewByCategories', () => {
  it('gives the same order whichever category answered first', () => {
    const categories = [category('c1'), category('c2'), category('c3')]
    const a = [item('s_live_5', 'live', 'c3'), item('s_live_1', 'live', 'c1'), item('s_live_2', 'live', 'c1'), item('s_live_3', 'live', 'c2')]
    const b = [item('s_live_3', 'live', 'c2'), item('s_live_1', 'live', 'c1'), item('s_live_2', 'live', 'c1'), item('s_live_5', 'live', 'c3')]
    const ids = (items: CatalogItem[]) => orderPreviewByCategories(items, categories).map((entry) => entry.id)
    expect(ids(a)).toEqual(['s_live_1', 's_live_2', 's_live_3', 's_live_5'])
    expect(ids(b)).toEqual(ids(a))
  })
})

describe('bootstrapReducer (F1-44)', () => {
  it('ignores a superseded run finishing after the run that replaced it', () => {
    let state = bootstrapReducer({ runId: 0, phases: {}, running: false, error: null, partialError: null }, { kind: 'start', runId: 1 })
    state = bootstrapReducer(state, { kind: 'start', runId: 2 })
    state = bootstrapReducer(state, { kind: 'finish', runId: 1, error: null, partialError: null })
    expect(state.running).toBe(true)
    state = bootstrapReducer(state, { kind: 'phase', runId: 1, type: 'live', phase: 'preview' })
    expect(state.phases).toEqual({})
    state = bootstrapReducer(state, { kind: 'finish', runId: 2, error: 'x', partialError: null })
    expect(state).toMatchObject({ running: false, error: 'x' })
  })
})

describe('useHomeBootstrap', () => {
  const source: PlaylistSource = { id: 's', name: 'Panel', type: 'xtream', ...CREDS, addedAt: 1 }
  const auth = { user_info: { auth: 1 } } as unknown as XtreamAuthResponse
  let liveCategories: ReturnType<typeof deferred<XtreamCategory[]>>
  let livePreview: ReturnType<typeof deferred<XtreamLiveStream[]>>

  beforeEach(() => {
    catalog.reset()
    liveCategories = deferred()
    livePreview = deferred()
    vi.spyOn(xtreamApi, 'getLiveCategories').mockImplementation(() => liveCategories.promise)
    vi.spyOn(xtreamApi, 'getLivePreviewStreams').mockImplementation(() => livePreview.promise)
    vi.spyOn(xtreamApi, 'getVodCategories').mockResolvedValue([])
    vi.spyOn(xtreamApi, 'getVodPreviewStreams').mockResolvedValue([])
    vi.spyOn(xtreamApi, 'getSeriesCategories').mockResolvedValue([])
    vi.spyOn(xtreamApi, 'getSeriesPreviewStreams').mockResolvedValue([])
    vi.mocked(ensureStagedSync).mockClear()
    useStore.setState({ sources: [source], activeSourceId: 's', xtreamAuth: {}, isLoadingPlaylist: false })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    catalog.reset()
    useStore.setState({ sources: [], activeSourceId: null, xtreamAuth: {}, isLoadingPlaylist: false })
  })

  it('starts before the sign-in finished and is not restarted by it or by unrelated store writes', async () => {
    const { result } = renderHook(() => useHomeBootstrap())
    expect(xtreamApi.getLiveCategories).toHaveBeenCalledTimes(1)
    const signal = vi.mocked(xtreamApi.getLiveCategories).mock.calls[0][1]?.signal

    act(() => {
      useStore.getState().setXtreamAuth('s', auth)
      useStore.getState().setVolume(0.3)
      // Another source's catalog changing used to cancel and restart the run.
      catalog.commit({ token: catalog.beginGeneration('other', 'live'), mode: 'replace', items: [] })
    })

    expect(xtreamApi.getLiveCategories).toHaveBeenCalledTimes(1)
    expect(signal?.aborted).toBe(false)
    expect(result.current.isBootstrapping).toBe(true)

    await act(async () => {
      liveCategories.resolve([xtreamCategory('1')])
      livePreview.resolve([])
      await flush()
    })
    await waitFor(() => expect(result.current.isBootstrapping).toBe(false))
    expect(ensureStagedSync).toHaveBeenCalledTimes(1)
  })

  it('shows an error with nothing to show when every request fails, and starts no full sync (F1-43)', async () => {
    const failure = new XtreamRequestError('http', 'Sunucu hata döndürdü (HTTP 500)', { status: 500 })
    vi.mocked(xtreamApi.getVodPreviewStreams).mockRejectedValue(failure)
    vi.mocked(xtreamApi.getSeriesPreviewStreams).mockRejectedValue(failure)
    const { result } = renderHook(() => useHomeBootstrap())

    await act(async () => {
      liveCategories.reject(failure)
      livePreview.reject(failure)
      await flush()
    })

    await waitFor(() => expect(result.current.error).toBe('Sunucu isteği reddetti (HTTP 500).'))
    expect(result.current.isBootstrapping).toBe(false)
    expect(useStore.getState().isLoadingPlaylist).toBe(false)
    expect(ensureStagedSync).not.toHaveBeenCalled()
  })

  it('keeps the loading state of the retry when the run it replaced settles later (F1-44)', async () => {
    const { result } = renderHook(() => useHomeBootstrap())
    const firstPreview = livePreview
    livePreview = deferred()

    act(() => result.current.retry())
    expect(xtreamApi.getLiveCategories).toHaveBeenCalledTimes(2)

    await act(async () => {
      liveCategories.resolve([])
      firstPreview.resolve([])
      await flush()
    })

    expect(result.current.isBootstrapping).toBe(true)
    expect(useStore.getState().isLoadingPlaylist).toBe(true)
  })
})
