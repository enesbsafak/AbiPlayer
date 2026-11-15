import type { CacheBackend } from '@/catalog/cache/backend'
import type { CatalogCategory, CatalogItem, CatalogType } from '@/catalog/types'
import { PlaylistRequestError, type PlaylistErrorKind } from '@/services/m3u-parser'
import { XtreamRequestError, type XtreamErrorKind } from '@/services/xtream-errors'
import type { EPGChannel, EPGProgram } from '@/types/epg'
import {
  CATALOG_WORKER_PROTOCOL,
  type JobResult,
  type ListMeta,
  type MainToWorker,
  type Unversioned,
  type WireError,
  type WorkerJob,
  type WorkerToMain
} from './protocol'
import type { WorkerRuntime } from './runtime'

/*
 * The main thread's side of the catalog worker: starts it, numbers jobs,
 * routes their messages to the caller's handlers, cancels them through an
 * AbortSignal and turns wire errors back into the app's error classes.
 *
 * Where there is no Worker (unit tests under jsdom) the same runtime runs in
 * the page behind a loopback that structured-clones every message, so what
 * crosses is checked the same way.
 */

export interface JobHandlers {
  onItems?(partition: CatalogType, items: CatalogItem[]): void
  onCategories?(partition: CatalogType, categories: CatalogCategory[]): void
  /** Every batch of these partitions has arrived. */
  onListEnd?(partitions: CatalogType[], meta: ListMeta, epgUrls: string[]): void
  onEpgBatch?(channels: EPGChannel[], programmes: Array<[string, EPGProgram[]]>): void
  onProgress?(phase: string, loaded?: number): void
}

export interface RunningJob {
  readonly id: number
  readonly result: Promise<JobResult>
}

export interface CatalogWorkerClient {
  start(job: WorkerJob, handlers?: JobHandlers, signal?: AbortSignal): RunningJob
  run(job: WorkerJob, handlers?: JobHandlers, signal?: AbortSignal): Promise<JobResult>
  /** Records for a running `cache-write` job. */
  putItems(id: number, partition: CatalogType, items: CatalogItem[], last: boolean): void
  /** The M3U cache key, raw; kept in memory and re-sent if the worker is replaced. */
  setKey(key: ArrayBuffer | null): void
  /** True while jobs run in a real Worker (false: in-page fallback). */
  readonly isolated: boolean
  terminate(): void
}

interface Port {
  post(message: MainToWorker): void
  terminate(): void
  readonly isolated: boolean
}

/** A wire error back as the class the rest of the app knows. */
export function fromWireError(wire: WireError): Error {
  const options = { status: wire.status, host: wire.host }
  if (wire.name === 'XtreamRequestError' || (wire.kind === 'aborted' && wire.name !== 'PlaylistRequestError')) {
    return new XtreamRequestError((wire.kind as XtreamErrorKind) ?? 'network', wire.message, options)
  }
  if (wire.name === 'PlaylistRequestError') return new PlaylistRequestError((wire.kind as PlaylistErrorKind) ?? 'network', wire.message, options)
  const error = new Error(wire.message) as Error & { kind?: string; status?: number; host?: string }
  error.name = wire.name
  if (wire.kind) error.kind = wire.kind
  if (wire.status !== undefined) error.status = wire.status
  if (wire.host) error.host = wire.host
  return error
}

/** Without a Worker the page still has IndexedDB (not under jsdom). */
const pageBackend = async (): Promise<CacheBackend | null> => {
  if (typeof indexedDB === 'undefined') return null
  const { IdbCacheBackend } = await import('@/catalog/cache/backend')
  return IdbCacheBackend.open()
}

export interface ClientOptions {
  /** Force the in-page runtime (tests), with this cache storage (null: none). */
  inPage?: { backend: CacheBackend | null }
}

export function createCatalogWorkerClient(options: ClientOptions = {}): CatalogWorkerClient {
  interface Pending {
    handlers: JobHandlers
    resolve(result: JobResult): void
    reject(error: unknown): void
  }
  const pending = new Map<number, Pending>()
  let nextId = 1
  let lastKey: ArrayBuffer | null | undefined

  const deliver = (message: WorkerToMain) => {
    if (message.v !== CATALOG_WORKER_PROTOCOL) return
    if (message.type === 'protocol-error') {
      console.warn('[catalog-worker]', message.message)
      return
    }
    const job = pending.get(message.id)
    if (!job) return
    switch (message.type) {
      case 'items':
        job.handlers.onItems?.(message.partition, message.items)
        return
      case 'categories':
        job.handlers.onCategories?.(message.partition, message.categories)
        return
      case 'list-end':
        job.handlers.onListEnd?.(message.partitions, message.meta, message.epgUrls)
        return
      case 'epg-batch':
        job.handlers.onEpgBatch?.(message.channels, message.programmes)
        return
      case 'progress':
        job.handlers.onProgress?.(message.phase, message.loaded)
        return
      case 'done':
        pending.delete(message.id)
        job.resolve(message.result)
        return
      case 'error':
        pending.delete(message.id)
        job.reject(fromWireError(message.error))
        return
    }
  }

  // The runtime (parsers, cache) is loaded only when it has to run in the
  // page, so none of it weighs on the page's first chunk.
  const inPagePort = (openBackend: () => Promise<CacheBackend | null>): Port => {
    let runtime: WorkerRuntime | null = null
    const queued: MainToWorker[] = []
    void import('./runtime').then(({ createWorkerRuntime }) => {
      runtime = createWorkerRuntime({
        // Cloned like a real postMessage, and delivered later.
        post: (message) => {
          const copy = structuredClone(message)
          queueMicrotask(() => deliver(copy))
        },
        openBackend
      })
      for (const message of queued.splice(0)) runtime.handle(message)
    })
    return {
      isolated: false,
      post: (message) => {
        const copy = structuredClone(message)
        if (runtime) runtime.handle(copy)
        else queued.push(copy)
      },
      terminate: () => undefined
    }
  }

  const failAll = (reason: string) => {
    for (const [id, job] of [...pending]) {
      pending.delete(id)
      job.reject(new XtreamRequestError('network', reason))
    }
  }

  let port: Port

  const workerPort = (): Port | null => {
    if (typeof Worker === 'undefined') return null
    let worker: Worker
    try {
      worker = new Worker(new URL('./catalog.worker.ts', import.meta.url), { type: 'module', name: 'abi-catalog' })
    } catch (error) {
      console.warn('[catalog-worker] could not start, running in the page:', error)
      return null
    }
    worker.onmessage = (event: MessageEvent<WorkerToMain>) => deliver(event.data)
    worker.onerror = (event) => {
      // The worker script failed to load or crashed: what was running is
      // reported as a retryable failure, and new jobs run in the page.
      console.warn('[catalog-worker] failed, running in the page from now on:', event.message)
      event.preventDefault()
      worker.terminate()
      port = inPagePort(pageBackend)
      if (lastKey !== undefined) port.post({ v: CATALOG_WORKER_PROTOCOL, type: 'key', key: lastKey })
      failAll('Katalog işlemi yarıda kaldı. Tekrar deneyin.')
    }
    return { isolated: true, post: (message) => worker.postMessage(message), terminate: () => worker.terminate() }
  }

  const inPageBackend = options.inPage?.backend ?? null
  port = options.inPage ? inPagePort(async () => inPageBackend) : (workerPort() ?? inPagePort(pageBackend))

  const send = (message: Unversioned<MainToWorker>) => port.post({ v: CATALOG_WORKER_PROTOCOL, ...message } as MainToWorker)

  const start: CatalogWorkerClient['start'] = (job, handlers = {}, signal) => {
    const id = nextId++
    const result = new Promise<JobResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new XtreamRequestError('aborted', 'İstek iptal edildi'))
        return
      }
      pending.set(id, { handlers, resolve, reject })
      signal?.addEventListener(
        'abort',
        () => {
          if (!pending.has(id)) return
          pending.delete(id)
          send({ type: 'cancel', id })
          reject(new XtreamRequestError('aborted', 'İstek iptal edildi'))
        },
        { once: true }
      )
      send({ type: 'job', id, job })
    })
    return { id, result }
  }

  return {
    start,
    run: (job, handlers, signal) => start(job, handlers, signal).result,
    putItems(id, partition, items, last) {
      send({ type: 'put-items', id, partition, items, last })
    },
    setKey(key) {
      lastKey = key
      send({ type: 'key', key })
    },
    get isolated() {
      return port.isolated
    },
    terminate() {
      port.terminate()
      failAll('Katalog işçisi kapatıldı.')
    }
  }
}

let shared: CatalogWorkerClient | null = null

/** The app's catalog worker, started on first use. */
export function catalogWorker(): CatalogWorkerClient {
  shared ??= createCatalogWorkerClient()
  return shared
}

/** Tests: replace the shared client (e.g. an in-page one with a memory cache). */
export function setCatalogWorkerForTests(client: CatalogWorkerClient | null): void {
  shared?.terminate()
  shared = client
}
