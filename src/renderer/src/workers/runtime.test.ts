import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCacheBackend } from '@/catalog/cache/backend'
import { createCatalogStore } from '@/catalog/catalog-store'
import { ingestFromCache, ingestM3uUrl, ingestXtreamList } from '@/catalog/worker-ingest'
import { sourceEpgUrl } from '@/catalog/source-meta'
import { XtreamRequestError } from '@/services/xtream-errors'
import { PlaylistRequestError } from '@/services/m3u-parser'
import type { PlaylistSource } from '@/types/playlist'
import { createCatalogWorkerClient, fromWireError } from './client'
import { createWorkerRuntime } from './runtime'
import { CATALOG_WORKER_PROTOCOL, ITEMS_PER_MESSAGE, toWireError, type WorkerToMain } from './protocol'

const creds = { url: 'http://panel.test', username: 'ali', password: 'sifre' }
const source: PlaylistSource = { id: 's', name: 'Panel', type: 'xtream', ...creds, addedAt: 1 }

function streams(count: number) {
  return Array.from({ length: count }, (_, index) => ({ stream_id: index + 1, name: `Kanal ${index + 1}`, category_id: String(1 + (index % 3)) }))
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

/** Panel answers by action; the categories call is answered too. */
function stubPanel(liveCount: number) {
  const fetchMock = vi.fn((url: string) => {
    const action = new URL(url).searchParams.get('action')
    if (action === 'get_live_streams') return Promise.resolve(jsonResponse(streams(liveCount)))
    if (action === 'get_live_categories') return Promise.resolve(jsonResponse([{ category_id: '1', category_name: 'Ulusal' }]))
    return Promise.resolve(jsonResponse([]))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('worker protocol', () => {
  it('keeps the Xtream and playlist error kinds, status and host across the boundary', () => {
    const xtream = fromWireError(toWireError(new XtreamRequestError('auth', 'Kimlik doğrulama başarısız', { status: 401, host: 'panel.test' })))
    expect(xtream).toBeInstanceOf(XtreamRequestError)
    expect(xtream).toMatchObject({ kind: 'auth', status: 401, host: 'panel.test', retryable: false })

    const playlist = fromWireError(toWireError(new PlaylistRequestError('network', 'bağlanılamadı', { host: 'cdn.test' })))
    expect(playlist).toBeInstanceOf(PlaylistRequestError)
    expect(playlist).toMatchObject({ kind: 'network', host: 'cdn.test' })

    expect(fromWireError(toWireError(new DOMException('Aborted', 'AbortError')))).toMatchObject({ kind: 'aborted' })
  })

  it('answers a message of another protocol version with a protocol error', () => {
    const posted: WorkerToMain[] = []
    const runtime = createWorkerRuntime({ post: (message) => posted.push(message), openBackend: async () => null })
    runtime.handle({ v: CATALOG_WORKER_PROTOCOL + 1, type: 'cancel', id: 1 } as never)
    expect(posted).toEqual([{ v: CATALOG_WORKER_PROTOCOL, type: 'protocol-error', message: expect.stringContaining('unsupported') }])
  })
})

describe('catalog worker jobs', () => {
  it('downloads a whole list off the main thread, posts it in bounded batches and caches it', async () => {
    stubPanel(ITEMS_PER_MESSAGE * 2 + 5)
    const backend = new MemoryCacheBackend()
    const worker = createCatalogWorkerClient({ inPage: { backend } })
    const store = createCatalogStore()
    const batches: number[] = []
    const spy = vi.spyOn(worker, 'run')
    spy.mockImplementation((job, handlers, signal) =>
      worker.start(job, { ...handlers, onItems: (type, items) => (batches.push(items.length), handlers?.onItems?.(type, items)) }, signal).result
    )

    const token = store.beginGeneration('s', 'live')
    const outcome = await ingestXtreamList({ sourceId: 's', type: 'live', creds, token }, { store, worker })

    expect(batches).toEqual([ITEMS_PER_MESSAGE, ITEMS_PER_MESSAGE, 5])
    expect(outcome.results.live).toBe('committed')
    expect(store.getItems('s', 'live')).toHaveLength(ITEMS_PER_MESSAGE * 2 + 5)
    expect(store.getStatus('s', 'live')).toMatchObject({ complete: true, fromCache: false, categoriesLoaded: true })
    expect(outcome.job).toMatchObject({ kind: 'lists', cache: { published: true, recordsTotal: ITEMS_PER_MESSAGE * 2 + 5 } })
    expect(backend.manifests.size).toBe(1)

    // The next start shows it from the cache, marked as such.
    const next = createCatalogStore()
    const cached = await ingestFromCache(source, ['live', 'vod', 'series'], { store: next, worker })
    expect(cached?.results.live).toBe('committed')
    expect(next.getItems('s', 'live').map((item) => item.id)).toEqual(store.getItems('s', 'live').map((item) => item.id))
    expect(next.getStatus('s', 'live')).toMatchObject({ complete: true, fromCache: true, fetchedAt: expect.any(Number) })
  })

  it('cancels a running download in the worker when the source is removed, and commits nothing', async () => {
    let workerSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        workerSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      })
    )
    const worker = createCatalogWorkerClient({ inPage: { backend: new MemoryCacheBackend() } })
    const store = createCatalogStore()
    const token = store.beginGeneration('s', 'live')
    const running = ingestXtreamList({ sourceId: 's', type: 'live', creds, token }, { store, worker, signal: store.sourceSignal('s') })
    await vi.waitFor(() => expect(workerSignal).toBeDefined())

    store.removeSource('s')

    await expect(running).rejects.toMatchObject({ kind: 'aborted' })
    await vi.waitFor(() => expect(workerSignal?.aborted).toBe(true))
    expect(store.getStatus('s', 'live')).toBeNull()
  })

  it('drops the staged lists of a source refreshed while they were arriving', async () => {
    stubPanel(10)
    const worker = createCatalogWorkerClient({ inPage: { backend: null } })
    const store = createCatalogStore()
    const token = store.beginGeneration('s', 'live')
    const pending = ingestXtreamList({ sourceId: 's', type: 'live', creds, token }, { store, worker })
    store.replaceSource('s', null)
    const outcome = await pending
    expect(outcome.results.live).toBe('stale')
    expect(store.getItems('s', 'live')).toHaveLength(0)
  })

  it('streams an M3U playlist, swaps its types in together, keeps the url-tvg in memory and caches it sealed', async () => {
    const playlist = [
      '#EXTM3U url-tvg="http://panel.test/xmltv.php?username=ali&password=sifre"',
      '#EXTINF:-1 tvg-id="k1" group-title="Haber",Kanal 1',
      'http://panel.test/live/ali/sifre/1.ts',
      '#EXTINF:-1 group-title="Filmler",Film',
      'http://panel.test/movie/ali/sifre/2.mp4'
    ].join('\n')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(playlist, { status: 200 }))))
    const backend = new MemoryCacheBackend()
    const worker = createCatalogWorkerClient({ inPage: { backend } })
    worker.setKey(new Uint8Array(32).fill(3).buffer)
    const store = createCatalogStore()

    const outcome = await ingestM3uUrl('m', 'http://panel.test/get.php?username=ali&password=sifre', { store, worker })

    expect(outcome.results).toEqual({ live: 'committed', vod: 'committed', series: 'committed' })
    expect(store.getItems('m', 'live').map((item) => item.name)).toEqual(['Kanal 1'])
    expect(store.getItems('m', 'vod').map((item) => item.name)).toEqual(['Film'])
    expect(sourceEpgUrl('m')).toBe('http://panel.test/xmltv.php?username=ali&password=sifre')
    expect(outcome.job).toMatchObject({ cache: { published: true } })
    expect([...backend.chunks.values()].every((chunk) => chunk.sealed)).toBe(true)
  })

  it('reports a failed download with its typed error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 403 }))))
    const worker = createCatalogWorkerClient({ inPage: { backend: null } })
    const store = createCatalogStore()
    const token = store.beginGeneration('s', 'vod')
    await expect(ingestXtreamList({ sourceId: 's', type: 'vod', creds, token }, { store, worker })).rejects.toMatchObject({
      name: 'XtreamRequestError',
      kind: 'auth',
      status: 403,
      host: 'panel.test'
    })
  })
})
