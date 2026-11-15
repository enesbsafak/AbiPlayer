import type { CacheBackend } from '@/catalog/cache/backend'
import { CatalogCache, isSealedIdentity, type CacheWriteReport, type SourceIdentity } from '@/catalog/cache/catalog-cache'
import { slices } from '@/catalog/cache/chunking'
import { createCacheCipher } from '@/catalog/cache/cipher'
import {
  m3uPlaylistToReplacement,
  xtreamCategoriesToRecords,
  xtreamLiveToRecords,
  xtreamSeriesToRecords,
  xtreamVodToRecords
} from '@/catalog/convert'
import { CATALOG_TYPES, type CatalogCategory, type CatalogItem, type CatalogType } from '@/catalog/types'
import { fetchAndParseEPG } from '@/services/xmltv-parser'
import { fetchM3uStreamed, parseM3U, type ParsedPlaylist } from '@/services/m3u-parser'
import {
  normalizeXtreamCategories,
  normalizeXtreamLiveStreams,
  normalizeXtreamSeries,
  normalizeXtreamVodStreams
} from '@/services/xtream-normalize'
import {
  XTREAM_DEFAULT_MAX_RETRIES,
  XTREAM_FULL_LIST_HEADERS_TIMEOUT_MS,
  XTREAM_HEADERS_TIMEOUT_MS,
  buildUrl,
  requestWithRetry
} from '@/services/xtream-request'
import type { EPGChannel, EPGProgram } from '@/types/epg'
import type { XtreamCredentials } from '@/types/xtream'
import {
  CATALOG_WORKER_PROTOCOL,
  ITEMS_PER_MESSAGE,
  toWireError,
  type JobResult,
  type ListMeta,
  type MainToWorker,
  type Unversioned,
  type WorkerJob,
  type WorkerToMain
} from './protocol'

/*
 * The catalog worker's logic, independent of where it runs: inside the Web
 * Worker (catalog.worker.ts) or, where there is no Worker (unit tests), in the
 * page through a loopback that clones every message the same way.
 */

export interface WorkerRuntimeDeps {
  post(message: WorkerToMain): void
  /** The cache storage; null runs without a cache. */
  openBackend(): Promise<CacheBackend | null>
}

export interface WorkerRuntime {
  handle(message: MainToWorker): void
}

type ListType = CatalogType

const LIST_ACTIONS: Record<ListType, { streams: string; categories: string }> = {
  live: { streams: 'get_live_streams', categories: 'get_live_categories' },
  vod: { streams: 'get_vod_streams', categories: 'get_vod_categories' },
  series: { streams: 'get_series', categories: 'get_series_categories' }
}

function toRecords(type: ListType, raw: unknown, sourceId: string): CatalogItem[] {
  if (type === 'live') return xtreamLiveToRecords(normalizeXtreamLiveStreams(raw), sourceId)
  if (type === 'vod') return xtreamVodToRecords(normalizeXtreamVodStreams(raw), sourceId)
  return xtreamSeriesToRecords(normalizeXtreamSeries(raw), sourceId)
}

interface JobContext {
  id: number
  signal: AbortSignal
  post(message: WorkerToMain): void
  /** Items the main thread sends for a `cache-write` job. */
  incoming: Map<CatalogType, CatalogItem[]>
  incomingDone: Set<CatalogType>
  onIncoming: (() => void) | null
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('İş iptal edildi', 'AbortError')
}

export function createWorkerRuntime(deps: WorkerRuntimeDeps): WorkerRuntime {
  const jobs = new Map<number, { controller: AbortController; context: JobContext }>()
  let cachePromise: Promise<CatalogCache | null> | null = null
  /** Settles once the latest key message is applied; every job waits for it. */
  let keyReady: Promise<void> = Promise.resolve()

  const post = (message: Unversioned<WorkerToMain>) => deps.post({ v: CATALOG_WORKER_PROTOCOL, ...message } as WorkerToMain)

  const getCache = (): Promise<CatalogCache | null> => {
    cachePromise ??= deps
      .openBackend()
      .then((backend) => (backend ? new CatalogCache(backend) : null))
      .catch((error: unknown) => {
        console.warn('[catalog-worker] cache unavailable:', error instanceof Error ? error.message : error)
        return null
      })
    return cachePromise
  }

  const postLists = (
    ctx: JobContext,
    lists: Array<{ type: CatalogType; items: readonly CatalogItem[]; categories: readonly CatalogCategory[] | null }>
  ) => {
    for (const list of lists) {
      for (const batch of slices(list.items, ITEMS_PER_MESSAGE)) post({ type: 'items', id: ctx.id, partition: list.type, items: batch })
      if (list.categories) post({ type: 'categories', id: ctx.id, partition: list.type, categories: [...list.categories] })
    }
  }

  async function xtreamList(job: Extract<WorkerJob, { kind: 'xtream-list' }>, ctx: JobContext): Promise<JobResult> {
    const actions = LIST_ACTIONS[job.type]
    const { data } = await requestWithRetry(
      buildUrl(job.creds, actions.streams),
      ctx.signal,
      XTREAM_DEFAULT_MAX_RETRIES,
      XTREAM_FULL_LIST_HEADERS_TIMEOUT_MS
    )
    post({ type: 'progress', id: ctx.id, phase: 'received' })
    const items = toRecords(job.type, data, job.sourceId)
    const fetchedAt = Date.now()
    let categories = job.categories
    if (!categories) categories = await fetchCategories(job.creds, job.type, job.sourceId, ctx.signal)
    throwIfAborted(ctx.signal)

    const meta: ListMeta = { fetchedAt, origin: 'network' }
    postLists(ctx, [{ type: job.type, items, categories }])
    post({ type: 'list-end', id: ctx.id, partitions: [job.type], meta, epgUrls: [] })

    const cache = job.cache ? await getCache() : null
    let report: CacheWriteReport | null = null
    if (cache) {
      report = await cache.write({
        sourceId: job.sourceId,
        identity: { kind: 'xtream', url: job.creds.url, username: job.creds.username },
        sourceRevision: job.revision,
        fetchedAt,
        partitions: [{ partition: job.type, items, categories }],
        shouldPublish: () => !ctx.signal.aborted
      })
    }
    return { kind: 'lists', meta, counts: { [job.type]: items.length }, epgUrls: [], cache: report }
  }

  async function fetchCategories(
    creds: XtreamCredentials,
    type: ListType,
    sourceId: string,
    signal: AbortSignal
  ): Promise<CatalogCategory[] | null> {
    try {
      const { data } = await requestWithRetry(buildUrl(creds, LIST_ACTIONS[type].categories), signal, XTREAM_DEFAULT_MAX_RETRIES, XTREAM_HEADERS_TIMEOUT_MS)
      return xtreamCategoriesToRecords(normalizeXtreamCategories(data), sourceId, type)
    } catch (error) {
      if (signal.aborted) throw error
      // The list is complete without them; the pages fetch categories themselves.
      return null
    }
  }

  async function m3u(job: Extract<WorkerJob, { kind: 'm3u-url' | 'm3u-text' }>, ctx: JobContext): Promise<JobResult> {
    let parsed: ParsedPlaylist
    if (job.kind === 'm3u-url') {
      parsed = await fetchM3uStreamed(job.url, job.sourceId, {
        signal: ctx.signal,
        onProgress: (loaded) => post({ type: 'progress', id: ctx.id, phase: 'download', loaded })
      })
    } else {
      parsed = parseM3U(job.text, job.sourceId)
    }
    throwIfAborted(ctx.signal)
    const fetchedAt = Date.now()
    const replacement = m3uPlaylistToReplacement(parsed)
    const lists = CATALOG_TYPES.map((type) => ({
      type,
      items: replacement[type]?.items ?? [],
      categories: replacement[type]?.categories ?? []
    }))
    const meta: ListMeta = { fetchedAt, origin: 'network' }
    postLists(ctx, lists)
    post({ type: 'list-end', id: ctx.id, partitions: [...CATALOG_TYPES], meta, epgUrls: parsed.epgUrls })

    const identity: SourceIdentity = job.kind === 'm3u-url' ? { kind: 'm3u_url', url: job.url } : { kind: 'm3u_file', path: job.path }
    const cache = job.cache ? await getCache() : null
    let report: CacheWriteReport | null = null
    if (cache) {
      report = await cache.write({
        sourceId: job.sourceId,
        identity,
        sourceRevision: job.revision,
        fetchedAt,
        partitions: lists.map((list) => ({ partition: list.type, items: list.items, categories: list.categories })),
        extra: { epgUrls: parsed.epgUrls },
        shouldPublish: () => !ctx.signal.aborted
      })
    }
    const counts: Partial<Record<CatalogType, number>> = {}
    for (const list of lists) counts[list.type] = list.items.length
    return { kind: 'lists', meta, counts, epgUrls: parsed.epgUrls, cache: report }
  }

  async function cacheRead(job: Extract<WorkerJob, { kind: 'cache-read' }>, ctx: JobContext): Promise<JobResult> {
    const cache = await getCache()
    if (!cache) return { kind: 'cache-miss', reason: 'unavailable' }
    if (isSealedIdentity(job.identity) && !cache.keyId) return { kind: 'cache-miss', reason: 'no-key' }
    cache.beginRead(job.sourceId)
    try {
      return await readCached(cache, job, ctx)
    } finally {
      await cache.endRead(job.sourceId)
    }
  }

  async function readCached(cache: CatalogCache, job: Extract<WorkerJob, { kind: 'cache-read' }>, ctx: JobContext): Promise<JobResult> {
    const result = await cache.read(job.sourceId, job.identity, job.types)
    if (result.status === 'miss') return { kind: 'cache-miss', reason: 'empty' }
    if (result.status === 'discarded') return { kind: 'cache-miss', reason: result.reason }

    const sealed = isSealedIdentity(job.identity)
    const extra = result.extra as { epgUrls?: unknown } | null
    const epgUrls = Array.isArray(extra?.epgUrls) ? extra.epgUrls.filter((url): url is string => typeof url === 'string') : []
    const counts: Partial<Record<CatalogType, number>> = {}
    try {
      for (const { partition, manifest } of result.partitions) {
        let count = 0
        for await (const chunk of cache.readItems(manifest)) {
          throwIfAborted(ctx.signal)
          for (const batch of slices(chunk, ITEMS_PER_MESSAGE)) post({ type: 'items', id: ctx.id, partition, items: batch })
          count += chunk.length
        }
        const categories = await cache.readCategories(manifest)
        if (categories) post({ type: 'categories', id: ctx.id, partition, categories })
        counts[partition] = count
        // Xtream types were fetched separately and are shown as each is read;
        // an M3U source's types belong together and are swapped in at once.
        if (!sealed) post({ type: 'list-end', id: ctx.id, partitions: [partition], meta: { fetchedAt: manifest.fetchedAt, origin: 'cache' }, epgUrls: [] })
      }
    } catch (error) {
      if (ctx.signal.aborted) throw error
      // A chunk that is gone or does not decrypt: the source is refetched.
      await cache.dropIfUnchanged(job.sourceId, result.partitions).catch(() => undefined)
      return { kind: 'cache-miss', reason: 'corrupt' }
    }
    const fetchedAt = Math.min(...result.partitions.map(({ manifest }) => manifest.fetchedAt))
    const meta: ListMeta = { fetchedAt, origin: 'cache' }
    if (sealed) post({ type: 'list-end', id: ctx.id, partitions: result.partitions.map(({ partition }) => partition), meta, epgUrls })
    return { kind: 'lists', meta, counts, epgUrls, cache: null }
  }

  async function cacheWrite(job: Extract<WorkerJob, { kind: 'cache-write' }>, ctx: JobContext): Promise<JobResult> {
    const wanted = new Set(job.partitions.map((partition) => partition.type))
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (ctx.signal.aborted) reject(new DOMException('İş iptal edildi', 'AbortError'))
        else if ([...wanted].every((type) => ctx.incomingDone.has(type))) resolve()
      }
      ctx.onIncoming = check
      ctx.signal.addEventListener('abort', check, { once: true })
      check()
    })
    const cache = await getCache()
    if (!cache) return { kind: 'cache-miss', reason: 'unavailable' }
    const report = await cache.write({
      sourceId: job.sourceId,
      identity: job.identity,
      sourceRevision: job.revision,
      fetchedAt: job.fetchedAt,
      partitions: job.partitions.map((partition) => ({
        partition: partition.type,
        items: ctx.incoming.get(partition.type) ?? [],
        categories: partition.categories
      })),
      extra: job.extra ?? undefined,
      shouldPublish: () => !ctx.signal.aborted
    })
    return { kind: 'cache-written', report }
  }

  type CachedEpgEntry = { key: string; channel: EPGChannel | null; programs: EPGProgram[] }

  function postEpg(ctx: JobContext, entries: readonly CachedEpgEntry[]): number {
    let programmes = 0
    for (const batch of slices(entries, 500)) {
      const channels: EPGChannel[] = []
      const lists: Array<[string, EPGProgram[]]> = []
      for (const entry of batch) {
        if (entry.channel) channels.push(entry.channel)
        if (entry.programs.length > 0) lists.push([entry.key, entry.programs])
        programmes += entry.programs.length
      }
      post({ type: 'epg-batch', id: ctx.id, channels, programmes: lists })
    }
    return programmes
  }

  async function epg(job: Extract<WorkerJob, { kind: 'epg' }>, ctx: JobContext): Promise<JobResult> {
    const data = await fetchAndParseEPG(job.url, {
      signal: ctx.signal,
      channelKeys: job.channelKeys ? new Set(job.channelKeys) : null,
      window: { windowStart: job.windowStart, windowEnd: job.windowEnd },
      onProgress: (loaded) => post({ type: 'progress', id: ctx.id, phase: 'download', loaded })
    })
    throwIfAborted(ctx.signal)
    const fetchedAt = Date.now()
    const keys = new Set([...Object.keys(data.channels), ...Object.keys(data.programs)])
    const entries: CachedEpgEntry[] = [...keys].map((key) => ({ key, channel: data.channels[key] ?? null, programs: data.programs[key] ?? [] }))
    const programmes = postEpg(ctx, entries)
    const truncated = data.truncatedReason ?? null
    const cache = job.cache ? await getCache() : null
    if (cache) {
      await cache.writeEpg({
        sourceId: job.sourceId,
        identity: job.identity,
        sourceRevision: job.revision,
        fetchedAt,
        channels: entries,
        truncated,
        shouldPublish: () => !ctx.signal.aborted
      })
    }
    return { kind: 'epg', meta: { fetchedAt, truncated, channels: keys.size, programmes, origin: 'network' } }
  }

  async function epgCacheRead(job: Extract<WorkerJob, { kind: 'epg-cache-read' }>, ctx: JobContext): Promise<JobResult> {
    const cache = await getCache()
    if (!cache) return { kind: 'cache-miss', reason: 'unavailable' }
    const cached = await cache.readEpg(job.sourceId, job.identity)
    if (!cached) return { kind: 'cache-miss', reason: 'empty' }
    // An older guide: programmes that have ended since are dropped.
    const entries = (cached.channels as CachedEpgEntry[]).map((entry) => ({
      ...entry,
      programs: entry.programs.filter((program) => program.end >= job.windowStart && program.start <= job.windowEnd)
    }))
    const programmes = postEpg(ctx, entries)
    return {
      kind: 'epg',
      meta: {
        fetchedAt: cached.manifest.fetchedAt,
        truncated: cached.manifest.epgTruncated ?? null,
        channels: entries.length,
        programmes,
        origin: 'cache'
      }
    }
  }

  async function run(job: WorkerJob, ctx: JobContext): Promise<JobResult> {
    await keyReady
    switch (job.kind) {
      case 'xtream-list':
        return xtreamList(job, ctx)
      case 'm3u-url':
      case 'm3u-text':
        return m3u(job, ctx)
      case 'cache-read':
        return cacheRead(job, ctx)
      case 'cache-write':
        return cacheWrite(job, ctx)
      case 'cache-drop': {
        const cache = await getCache()
        await cache?.dropSource(job.sourceId, job.revision)
        return { kind: 'ok' }
      }
      case 'cache-retain': {
        const cache = await getCache()
        await cache?.collectGarbage(job.sourceIds)
        return { kind: 'ok' }
      }
      case 'epg':
        return epg(job, ctx)
      case 'epg-cache-read':
        return epgCacheRead(job, ctx)
      case 'cache-stats': {
        const cache = await getCache()
        if (!cache) return { kind: 'stats', manifests: 0, chunks: 0, available: false }
        const stats = await cache.stats()
        return { kind: 'stats', ...stats, available: true }
      }
    }
  }

  const startJob = (id: number, job: WorkerJob) => {
    const controller = new AbortController()
    const context: JobContext = {
      id,
      signal: controller.signal,
      post: deps.post,
      incoming: new Map(),
      incomingDone: new Set(),
      onIncoming: null
    }
    jobs.set(id, { controller, context })
    run(job, context)
      .then(
        (result) => post({ type: 'done', id, result }),
        (error: unknown) => {
          const wire = toWireError(error)
          if (controller.signal.aborted) wire.kind = 'aborted'
          post({ type: 'error', id, error: wire })
        }
      )
      .finally(() => jobs.delete(id))
  }

  return {
    handle(message) {
      if (!message || message.v !== CATALOG_WORKER_PROTOCOL) {
        deps.post({ v: CATALOG_WORKER_PROTOCOL, type: 'protocol-error', message: `unsupported protocol ${String(message?.v)}` })
        return
      }
      switch (message.type) {
        case 'job':
          startJob(message.id, message.job)
          return
        case 'cancel':
          jobs.get(message.id)?.controller.abort()
          return
        case 'put-items': {
          const entry = jobs.get(message.id)
          if (!entry) return
          const { context } = entry
          const list = context.incoming.get(message.partition)
          if (list) for (const item of message.items) list.push(item)
          else context.incoming.set(message.partition, [...message.items])
          if (message.last) context.incomingDone.add(message.partition)
          context.onIncoming?.()
          return
        }
        case 'key': {
          const raw = message.key
          keyReady = keyReady.then(async () => {
            const cache = await getCache()
            if (!cache) return
            try {
              cache.setCipher(raw ? await createCacheCipher(raw) : null)
            } catch (error) {
              console.warn('[catalog-worker] cache key rejected:', error instanceof Error ? error.message : error)
              cache.setCipher(null)
            }
          })
          return
        }
      }
    }
  }
}
