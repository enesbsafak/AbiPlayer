import { catalogWorker, type CatalogWorkerClient, type JobHandlers } from '@/workers/client'
import type { JobResult, ListMeta } from '@/workers/protocol'
import { perfMark } from '@/services/perf'
import type { PlaylistSource } from '@/types/playlist'
import type { XtreamCredentials } from '@/types/xtream'
import type { SourceIdentity } from './cache/catalog-cache'
import { catalog as defaultCatalog, type CatalogStore, type StagedReplace } from './catalog-store'
import { setSourceEpgUrls } from './source-meta'
import { cacheKeyReady } from './cache-key'
import {
  CATALOG_TYPES,
  type CatalogCategory,
  type CatalogType,
  type CommitResult,
  type GenerationToken
} from './types'

/*
 * Feeding the catalog store from the worker. Tokens are taken before a job
 * is posted; the worker's batches go into staged replaces (indexed as they
 * arrive, invisible until the end) and are swapped in on `list-end` through
 * the store's commit guard, so a removed or refreshed source drops them.
 */

export interface IngestOptions {
  store?: CatalogStore
  worker?: CatalogWorkerClient
  signal?: AbortSignal
}

export interface IngestOutcome {
  /** Per type: what the swap did; absent for types the job did not deliver. */
  results: Partial<Record<CatalogType, CommitResult>>
  counts: Partial<Record<CatalogType, number>>
  meta: ListMeta | null
  epgUrls: string[]
  job: JobResult
}

/**
 * Handlers that stage each partition's batches and swap them in on `list-end`.
 * `worker` only labels the timing mark: whether the job ran in a real Worker
 * or in the in-page fallback (the packaged end-to-end run checks it).
 */
function stagingHandlers(
  store: CatalogStore,
  tokens: Map<CatalogType, GenerationToken>,
  outcome: IngestOutcome,
  worker: Pick<CatalogWorkerClient, 'isolated'>
): JobHandlers {
  const stages = new Map<CatalogType, StagedReplace>()
  const categories = new Map<CatalogType, CatalogCategory[]>()
  const stageFor = (type: CatalogType): StagedReplace | null => {
    let stage = stages.get(type)
    if (!stage) {
      const token = tokens.get(type)
      if (!token) return null
      stage = store.beginReplace(token)
      stages.set(type, stage)
    }
    return stage
  }
  return {
    onItems(type, items) {
      stageFor(type)?.append(items)
    },
    onCategories(type, list) {
      categories.set(type, list)
    },
    onListEnd(partitions, meta, epgUrls) {
      outcome.meta = meta
      outcome.epgUrls = epgUrls
      // All partitions of one list-end are swapped in the same task: an M3U
      // source's three types appear together.
      for (const type of partitions) {
        const stage = stageFor(type)
        if (!stage) continue
        const result = stage.finish({ categories: categories.get(type), origin: { fromCache: meta.origin === 'cache', fetchedAt: meta.fetchedAt } })
        outcome.results[type] = result
        outcome.counts[type] = stage.count
        if (result === 'committed') {
          perfMark(meta.origin === 'cache' ? 'cache:committed' : 'ingest:committed', {
            type,
            items: stage.count,
            isolated: worker.isolated
          })
        }
        stages.delete(type)
      }
    }
  }
}

/**
 * The job delivered lists that the catalog refused because the source was
 * removed or refreshed meanwhile (`stale`): nothing of it is on screen.
 */
export function ingestDropped(outcome: IngestOutcome): boolean {
  return Object.values(outcome.results).includes('stale')
}

function emptyOutcome(): IngestOutcome {
  return { results: {}, counts: {}, meta: null, epgUrls: [], job: { kind: 'ok' } }
}

/** One whole Xtream list through the worker (download, parse, records, cache), swapped in under `token`. */
export async function ingestXtreamList(
  args: { sourceId: string; type: CatalogType; creds: XtreamCredentials; token: GenerationToken },
  options: IngestOptions = {}
): Promise<IngestOutcome> {
  const store = options.store ?? defaultCatalog
  const worker = options.worker ?? catalogWorker()
  const status = store.getStatus(args.sourceId, args.type)
  const categories = status?.categoriesLoaded ? [...store.getCategories(args.sourceId, args.type)] : null
  const outcome = emptyOutcome()
  const handlers = stagingHandlers(store, new Map([[args.type, args.token]]), outcome, worker)
  outcome.job = await worker.run(
    {
      kind: 'xtream-list',
      sourceId: args.sourceId,
      type: args.type,
      creds: { url: args.creds.url, username: args.creds.username, password: args.creds.password },
      revision: args.token.revision,
      categories,
      cache: true
    },
    handlers,
    options.signal
  )
  return outcome
}

function tokensFor(store: CatalogStore, sourceId: string, types: readonly CatalogType[] = CATALOG_TYPES): Map<CatalogType, GenerationToken> {
  return new Map(types.map((type) => [type, store.beginGeneration(sourceId, type)]))
}

/** An M3U playlist from its URL through the worker (streamed, parsed, cached sealed), all types swapped in at once. */
export async function ingestM3uUrl(sourceId: string, url: string, options: IngestOptions = {}): Promise<IngestOutcome> {
  const store = options.store ?? defaultCatalog
  const worker = options.worker ?? catalogWorker()
  const tokens = tokensFor(store, sourceId)
  const outcome = emptyOutcome()
  perfMark('connect:m3u-fetch-start')
  await cacheKeyReady()
  outcome.job = await worker.run(
    { kind: 'm3u-url', sourceId, url, revision: store.getSourceRevision(sourceId), cache: true },
    stagingHandlers(store, tokens, outcome, worker),
    options.signal
  )
  if (outcome.results.live === 'committed') setSourceEpgUrls(sourceId, outcome.epgUrls)
  perfMark('connect:m3u-added', { channels: Object.values(outcome.counts).reduce((sum, count) => sum + (count ?? 0), 0) })
  return outcome
}

/** A local playlist's text (read by main) through the worker. */
export async function ingestM3uText(
  sourceId: string,
  text: string,
  path: string,
  options: IngestOptions = {}
): Promise<IngestOutcome> {
  const store = options.store ?? defaultCatalog
  const worker = options.worker ?? catalogWorker()
  const tokens = tokensFor(store, sourceId)
  const outcome = emptyOutcome()
  await cacheKeyReady()
  outcome.job = await worker.run(
    { kind: 'm3u-text', sourceId, text, path, revision: store.getSourceRevision(sourceId), cache: true },
    stagingHandlers(store, tokens, outcome, worker),
    options.signal
  )
  if (outcome.results.live === 'committed') setSourceEpgUrls(sourceId, outcome.epgUrls)
  return outcome
}

/** What the cache knows a source by, or null when it cannot be told yet (secret not loaded). */
export function sourceIdentity(source: PlaylistSource): SourceIdentity | null {
  if (source.type === 'xtream') return source.url && source.username ? { kind: 'xtream', url: source.url, username: source.username } : null
  if (source.type === 'm3u_url') return source.url ? { kind: 'm3u_url', url: source.url } : null
  return source.filePath ? { kind: 'm3u_file', path: source.filePath } : null
}

/**
 * The cached lists of a source, shown at once through the same commit path,
 * marked as coming from the cache. Types that a fresher list reached first
 * are left alone (their swap is `superseded`).
 */
export async function ingestFromCache(
  source: PlaylistSource,
  types: readonly CatalogType[] = CATALOG_TYPES,
  options: IngestOptions = {}
): Promise<IngestOutcome | null> {
  const identity = sourceIdentity(source)
  if (!identity) return null
  const store = options.store ?? defaultCatalog
  const worker = options.worker ?? catalogWorker()
  const tokens = tokensFor(store, source.id, types)
  const outcome = emptyOutcome()
  perfMark('cache:read-start', { source: source.type })
  if (source.type !== 'xtream') await cacheKeyReady()
  outcome.job = await worker.run(
    { kind: 'cache-read', sourceId: source.id, identity, types: [...types], revision: store.getSourceRevision(source.id) },
    stagingHandlers(store, tokens, outcome, worker),
    options.signal
  )
  if (outcome.epgUrls.length > 0 && Object.values(outcome.results).includes('committed')) setSourceEpgUrls(source.id, outcome.epgUrls)
  perfMark('cache:read-done', { result: outcome.job.kind })
  return outcome
}
