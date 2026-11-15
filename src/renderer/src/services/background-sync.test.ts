import { describe, expect, it, vi } from 'vitest'
import { createCatalogStore } from '@/catalog/catalog-store'
import type { CatalogItem, CatalogType } from '@/catalog/types'
import { XtreamRequestError } from './xtream-errors'
import { createBackgroundSync, type FullListFetcher } from './background-sync'
import { useStore } from '@/store'

const creds = { url: 'http://panel.test', username: 'u', password: 'p' }

function record(id: string, type: CatalogType = 'live', sourceId = 's1'): CatalogItem {
  return { id, name: id, streamUrl: '', streamId: 1, sourceId, type, searchName: id, isAdult: false }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('background sync', () => {
  it('commits the full list as a complete generation that replaces the previous one', async () => {
    const catalog = createCatalogStore()
    catalog.commit({ token: catalog.beginGeneration('s1', 'live'), mode: 'partial', items: [record('gone')] })
    const fetcher: FullListFetcher = vi.fn(async () => [record('a'), record('b')])
    const sync = createBackgroundSync(catalog, fetcher)

    await sync.ensureFullSync('s1', 'live', creds)

    expect(catalog.getItems('s1', 'live').map((item) => item.id)).toEqual(['a', 'b'])
    expect(catalog.getStatus('s1', 'live')).toMatchObject({ complete: true, syncing: false, error: null })
  })

  it('refreshes a list served from the disk cache, keeping it on screen until the fresh one is in (C2c)', async () => {
    const catalog = createCatalogStore()
    catalog.commit({ token: catalog.beginGeneration('s1', 'live'), mode: 'replace', items: [record('cached')], origin: { fromCache: true, fetchedAt: 1 } })
    const fresh = deferred<CatalogItem[]>()
    const sync = createBackgroundSync(catalog, () => fresh.promise)

    const running = sync.ensureFullSync('s1', 'live', creds)
    expect(catalog.getItems('s1', 'live').map((item) => item.id)).toEqual(['cached'])
    expect(catalog.getStatus('s1', 'live')).toMatchObject({ complete: true, fromCache: true, syncing: true })
    fresh.resolve([record('fresh')])
    await running

    expect(catalog.getItems('s1', 'live').map((item) => item.id)).toEqual(['fresh'])
    expect(catalog.getStatus('s1', 'live')).toMatchObject({ complete: true, fromCache: false, syncing: false })
  })

  it('downloads a complete fresh list again only when asked to', async () => {
    const catalog = createCatalogStore()
    const fetcher: FullListFetcher = vi.fn(async () => [record('a')])
    const sync = createBackgroundSync(catalog, fetcher)
    await sync.ensureFullSync('s1', 'live', creds)
    await sync.ensureFullSync('s1', 'live', creds)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await sync.ensureFullSync('s1', 'live', creds, { refresh: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('shares one running sync and skips a complete list', async () => {
    const catalog = createCatalogStore()
    const fetcher: FullListFetcher = vi.fn(async () => [record('a')])
    const sync = createBackgroundSync(catalog, fetcher)

    await Promise.all([sync.ensureFullSync('s1', 'live', creds), sync.ensureFullSync('s1', 'live', creds)])
    await sync.ensureFullSync('s1', 'live', creds)

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('cancels a running sync when its source is removed and never resurrects it (F1-49)', async () => {
    const catalog = createCatalogStore()
    const pending = deferred<CatalogItem[]>()
    let signal: AbortSignal | null = null
    const sync = createBackgroundSync(catalog, async (_type, _creds, _sourceId, s) => {
      signal = s
      return pending.promise
    })

    const running = sync.ensureFullSync('s1', 'vod', creds)
    expect(catalog.getStatus('s1', 'vod')?.syncing).toBe(true)
    catalog.removeSource('s1')
    expect(signal!.aborted).toBe(true)

    pending.resolve([record('ghost', 'vod')])
    await running

    expect(catalog.getStatus('s1', 'vod')).toBeNull()
    expect(catalog.getItem('ghost')).toBeUndefined()
  })

  it('starts a fresh sync after a refresh instead of joining the cancelled one', async () => {
    const catalog = createCatalogStore()
    const first = deferred<CatalogItem[]>()
    const fetcher = vi
      .fn<FullListFetcher>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([record('fresh')])
    const sync = createBackgroundSync(catalog, fetcher)

    const cancelled = sync.ensureFullSync('s1', 'live', creds)
    catalog.replaceSource('s1', null)
    await sync.ensureFullSync('s1', 'live', creds)
    first.resolve([record('stale')])
    await cancelled

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(catalog.getItems('s1', 'live').map((item) => item.id)).toEqual(['fresh'])
  })

  it('records a typed failure in the status', async () => {
    const catalog = createCatalogStore()
    const sync = createBackgroundSync(catalog, async () => {
      throw new XtreamRequestError('http', 'Sunucu hatası (HTTP 503)', { status: 503 })
    })

    await sync.ensureFullSync('s1', 'series', creds)

    expect(catalog.getStatus('s1', 'series')).toMatchObject({
      syncing: false,
      complete: false,
      error: { kind: 'http', status: 503, retryable: true, message: 'Sunucu hatası (HTTP 503)' }
    })
  })

  it('reports an auth failure as not retryable', async () => {
    const catalog = createCatalogStore()
    const sync = createBackgroundSync(catalog, async () => {
      throw new XtreamRequestError('auth', 'Kimlik doğrulama başarısız', { status: 401 })
    })

    await sync.ensureFullSync('s1', 'live', creds)

    expect(catalog.getStatus('s1', 'live')?.error).toMatchObject({ kind: 'auth', retryable: false })
  })

  it('reports an untyped failure as unknown and retryable, with a safe message', async () => {
    const catalog = createCatalogStore()
    const sync = createBackgroundSync(catalog, async () => {
      throw new TypeError('Failed to fetch')
    })

    await sync.ensureFullSync('s1', 'live', creds)

    const error = catalog.getStatus('s1', 'live')?.error
    expect(error).toMatchObject({ kind: 'unknown', retryable: true })
    expect(error?.message).not.toBe('')
  })

  it('does not report a cancelled request as an error', async () => {
    const catalog = createCatalogStore()
    const sync = createBackgroundSync(catalog, async () => {
      throw new XtreamRequestError('aborted', 'İstek iptal edildi')
    })

    await sync.ensureFullSync('s1', 'live', creds)

    expect(catalog.getStatus('s1', 'live')).toMatchObject({ syncing: false, error: null })
  })

  it('clears the previous error when a sync starts again', async () => {
    const catalog = createCatalogStore()
    const fetcher = vi
      .fn<FullListFetcher>()
      .mockRejectedValueOnce(new XtreamRequestError('network', 'Sunucuya bağlanılamadı.'))
      .mockResolvedValueOnce([record('a')])
    const sync = createBackgroundSync(catalog, fetcher)

    await sync.ensureFullSync('s1', 'live', creds)
    expect(catalog.getStatus('s1', 'live')?.error?.kind).toBe('network')

    await sync.ensureFullSync('s1', 'live', creds)
    expect(catalog.getStatus('s1', 'live')).toMatchObject({ error: null, complete: true })
  })

  it('syncs the priority type first and leaves no progress behind for a removed source', async () => {
    const catalog = createCatalogStore()
    const live = deferred<CatalogItem[]>()
    const order: CatalogType[] = []
    const sync = createBackgroundSync(catalog, async (type) => {
      order.push(type)
      return type === 'live' ? live.promise : [record(`${type}-1`, type)]
    })

    const staged = sync.ensureStagedSync('s9', 'live', creds)
    expect(useStore.getState().syncProgress.s9).toMatchObject({ currentType: 'live', active: true })
    catalog.removeSource('s9')
    live.resolve([record('live-1')])
    await staged

    expect(order[0]).toBe('live')
    expect(useStore.getState().syncProgress.s9).toBeUndefined()
    expect(catalog.getItem('live-1')).toBeUndefined()
    expect(catalog.getSourceIds()).not.toContain('s9')
    expect(order).toEqual(['live'])
  })

  it('does not count a failed type as done (K12)', async () => {
    const catalog = createCatalogStore()
    const vod = deferred<CatalogItem[]>()
    const sync = createBackgroundSync(catalog, async (type) => {
      if (type === 'live') throw new XtreamRequestError('http', 'Sunucu hatası', { status: 500 })
      return type === 'vod' ? vod.promise : [record('series-1', 'series', 's7')]
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const staged = sync.ensureStagedSync('s7', 'live', creds)
    await vi.waitFor(() => expect(useStore.getState().syncProgress.s7).toMatchObject({ currentType: null, completedTypes: 1 }))
    vod.resolve([record('vod-1', 'vod', 's7')])
    await staged
    expect(useStore.getState().syncProgress.s7).toBeUndefined()
    vi.restoreAllMocks()
  })

  it('leaves the progress of a newer run alone when an overtaken run ends (K12)', async () => {
    const catalog = createCatalogStore()
    const first = deferred<CatalogItem[]>()
    const second = deferred<CatalogItem[]>()
    let calls = 0
    const sync = createBackgroundSync(catalog, async (type) => {
      if (type !== 'live') return [record(`${type}-x`, type, 's8')]
      calls += 1
      return calls === 1 ? first.promise : second.promise
    })

    const old = sync.ensureStagedSync('s8', 'live', creds)
    // A refresh: the old run's sync is cancelled and a new run starts.
    catalog.replaceSource('s8', null)
    const fresh = sync.ensureStagedSync('s8', 'live', creds)
    first.resolve([record('live-old', 'live', 's8')])
    await old

    expect(useStore.getState().syncProgress.s8).toMatchObject({ currentType: 'live', active: true })
    second.resolve([record('live-new', 'live', 's8')])
    await fresh
    expect(useStore.getState().syncProgress.s8).toBeUndefined()
  })
})
