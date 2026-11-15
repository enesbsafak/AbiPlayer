import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useStore } from '@/store'
import { forgetXtreamRequests, xtreamApi } from '@/services/xtream-api'
import { ensureStagedSync } from '@/services/background-sync'
import { classifyError, toUserMessage } from '@/services/user-error'
import { perfMark } from '@/services/perf'
import { catalog as defaultCatalog, type CatalogStore } from '@/catalog/catalog-store'
import { useCatalogCacheSettled } from '@/catalog/cache-lifecycle'
import { certificateAwareError } from '@/catalog/certificate-errors'
import {
  xtreamCategoriesToRecords,
  xtreamLiveToRecords,
  xtreamSeriesToRecords,
  xtreamVodToRecords
} from '@/catalog/convert'
import { CATALOG_TYPES, type CatalogCategory, type CatalogItem, type CatalogType } from '@/catalog/types'
import type { CatalogStatusMap } from '@/store/playlist-slice'
import type { XtreamCategory, XtreamCredentials } from '@/types/xtream'
import { formatDateTime, strings } from '@/strings'

const text = strings.catalog.home

// Message and progress bar come from one source so they can never drift apart.
export const BOOTSTRAP_STAGES = {
  idle: { message: text.stages.idle, progress: 0.1 },
  categories: { message: text.stages.categories, progress: 0.4 },
  preview: { message: text.stages.preview, progress: 0.75 },
  catalog: { message: text.stages.catalog, progress: 0.95 }
} as const

export type BootstrapStage = keyof typeof BOOTSTRAP_STAGES

export const PREVIEW_LIMITS: Record<CatalogType, number> = { live: 50, vod: 30, series: 30 }

/** Every type of the source holds a complete list. */
export function sourceCatalogComplete(status: CatalogStatusMap, sourceId: string | null): boolean {
  if (!sourceId) return false
  return CATALOG_TYPES.every((type) => status[sourceId]?.[type]?.complete === true)
}

/**
 * When the cached copy the source shows was fetched, while the provider
 * cannot be reached (its refresh failed, or the source failed to connect);
 * null when there is nothing to say.
 */
export function offlineCopySince(status: CatalogStatusMap, sourceId: string | null, connectionFailed: boolean): number | null {
  if (!sourceId) return null
  let since: number | null = null
  let refreshFailed = false
  for (const type of CATALOG_TYPES) {
    const entry = status[sourceId]?.[type]
    if (!entry?.fromCache || !entry.fetchedAt) continue
    since = since === null ? entry.fetchedAt : Math.min(since, entry.fetchedAt)
    if (entry.error) refreshFailed = true
  }
  return since !== null && (refreshFailed || connectionFailed) ? since : null
}

/** The home page's notice for a provider that is down while a cached copy is shown. */
export function offlineCopyMessage(since: number): string {
  return text.offlineCopy(formatDateTime(since))
}

/** Requests the bootstrap makes; injectable for tests. */
export interface HomeBootstrapApi {
  getCategories(type: CatalogType, creds: XtreamCredentials, signal: AbortSignal): Promise<XtreamCategory[]>
  /** A small batch of the type's items, already as records. */
  getPreview(type: CatalogType, creds: XtreamCredentials, sourceId: string, signal: AbortSignal): Promise<CatalogItem[]>
}

export const xtreamBootstrapApi: HomeBootstrapApi = {
  getCategories(type, creds, signal) {
    if (type === 'live') return xtreamApi.getLiveCategories(creds, { signal })
    if (type === 'vod') return xtreamApi.getVodCategories(creds, { signal })
    return xtreamApi.getSeriesCategories(creds, { signal })
  },
  async getPreview(type, creds, sourceId, signal) {
    const limit = PREVIEW_LIMITS[type]
    if (type === 'live') return xtreamLiveToRecords(await xtreamApi.getLivePreviewStreams(creds, limit, { signal }), sourceId)
    if (type === 'vod') return xtreamVodToRecords(await xtreamApi.getVodPreviewStreams(creds, limit, { signal }), sourceId)
    return xtreamSeriesToRecords(await xtreamApi.getSeriesPreviewStreams(creds, limit, { signal }), sourceId)
  }
}

/**
 * The preview is collected from several category requests running at once, so
 * its order was the order the responses happened to arrive in, and the
 * dashboard rows changed from one start to the next. Ordered by the category
 * list instead (stable within a category), it is the same every time.
 */
export function orderPreviewByCategories(
  items: readonly CatalogItem[],
  categories: readonly CatalogCategory[]
): CatalogItem[] {
  const rank = new Map<string, number>()
  categories.forEach((category, index) => {
    if (!rank.has(category.id)) rank.set(category.id, index)
  })
  const rankOf = (item: CatalogItem) =>
    item.categoryId !== undefined && rank.has(item.categoryId) ? rank.get(item.categoryId)! : categories.length
  return items
    .map((item, index) => ({ item, index, rank: rankOf(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item)
}

export type BootstrapPhase = 'categories' | 'preview'

export type BootstrapTypeOutcome =
  | { type: CatalogType; status: 'loaded'; count: number }
  | { type: CatalogType; status: 'empty' }
  | { type: CatalogType; status: 'failed'; error: unknown }
  | { type: CatalogType; status: 'cancelled' }

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || classifyError(error) === 'cancelled'
}

export interface RunHomeBootstrapOptions {
  sourceId: string
  creds: XtreamCredentials
  /** The types that still need a preview; the others already show content. */
  types: readonly CatalogType[]
  signal: AbortSignal
  catalog?: CatalogStore
  api?: HomeBootstrapApi
  onPhase?: (type: CatalogType, phase: BootstrapPhase | 'done') => void
}

/**
 * Categories, then a preview, for each type on its own: a type is committed
 * (and its row drawn) as soon as its own preview is in, instead of after the
 * slowest of the three. The preview is a partial batch: it never marks a list
 * complete; the full sync that follows replaces it.
 */
export async function runHomeBootstrap(options: RunHomeBootstrapOptions): Promise<BootstrapTypeOutcome[]> {
  const { sourceId, creds, types, signal } = options
  const store = options.catalog ?? defaultCatalog
  const api = options.api ?? xtreamBootstrapApi

  const runType = async (type: CatalogType): Promise<BootstrapTypeOutcome> => {
    // Taken before the first request: anything that comes back after the
    // source was removed or refreshed is dropped by the catalog.
    const token = store.beginGeneration(sourceId, type)
    let categories: CatalogCategory[] = []
    let categoriesError: unknown = null

    options.onPhase?.(type, 'categories')
    try {
      categories = xtreamCategoriesToRecords(await api.getCategories(type, creds, signal), sourceId, type)
      if (categories.length > 0) store.commit({ token, mode: 'partial', categories })
      perfMark('bootstrap:categories-done', { type })
    } catch (error) {
      if (isCancellation(error, signal)) return { type, status: 'cancelled' }
      // The preview may still work (it falls back to the whole list).
      categoriesError = await certificateAwareError(error)
    }

    options.onPhase?.(type, 'preview')
    try {
      const items = orderPreviewByCategories(await api.getPreview(type, creds, sourceId, signal), categories)
      if (signal.aborted) return { type, status: 'cancelled' }
      if (items.length > 0) {
        store.commit({ token, mode: 'partial', items })
        perfMark('bootstrap:preview-added', { type, items: items.length })
        return { type, status: 'loaded', count: items.length }
      }
      return categoriesError ? { type, status: 'failed', error: categoriesError } : { type, status: 'empty' }
    } catch (error) {
      if (isCancellation(error, signal)) return { type, status: 'cancelled' }
      // A refused certificate fails like a network error; main knows better.
      return { type, status: 'failed', error: await certificateAwareError(error) }
    } finally {
      options.onPhase?.(type, 'done')
    }
  }

  perfMark('bootstrap:start')
  const outcomes = await Promise.all(types.map(runType))
  perfMark('bootstrap:previews-done')
  return outcomes
}

export interface BootstrapFailure {
  type: CatalogType
  label: string
  message: string
}

export interface BootstrapSummary {
  /** Every type that was tried failed and no other type shows content: nothing to show, offer "Yeniden Dene". */
  allFailed: boolean
  failures: BootstrapFailure[]
  cancelled: boolean
}

/**
 * `othersLoaded`: types that were not tried because they already show
 * content (a retry after a partial failure tries only the rest). Then even
 * failing every tried type is a partial failure, not "nothing to show".
 */
export function summarizeBootstrap(
  outcomes: readonly BootstrapTypeOutcome[],
  options: { othersLoaded?: boolean } = {}
): BootstrapSummary {
  const failures: BootstrapFailure[] = []
  let cancelled = false
  for (const outcome of outcomes) {
    if (outcome.status === 'cancelled') cancelled = true
    if (outcome.status !== 'failed') continue
    failures.push({
      type: outcome.type,
      label: strings.catalog.types[outcome.type].section,
      message: toUserMessage(outcome.error, text.typeLoadFailed)
    })
  }
  return {
    allFailed: !cancelled && !options.othersLoaded && outcomes.length > 0 && failures.length === outcomes.length,
    failures,
    cancelled
  }
}

/** One line for a partial failure: what did not load and why. */
export function partialFailureMessage(failures: readonly BootstrapFailure[]): string | null {
  if (failures.length === 0) return null
  const reasons = [...new Set(failures.map((failure) => failure.message))].join(' ')
  return text.partialFailure(failures.map((failure) => failure.label).join(', '), reasons)
}

export function bootstrapStageOf(phases: Partial<Record<CatalogType, BootstrapPhase | 'done'>>, running: boolean): BootstrapStage {
  const values = Object.values(phases)
  if (values.includes('categories')) return 'categories'
  if (values.includes('preview')) return 'preview'
  return running ? 'catalog' : 'idle'
}

export interface HomeBootstrap {
  /** Every catalog request of the bootstrap failed; a user message. */
  error: string | null
  /** Some types loaded and some did not: says which did not. */
  partialError: string | null
  isBootstrapping: boolean
  stage: BootstrapStage
  /** Types whose preview is still on its way (their rows show a placeholder). */
  loadingTypes: readonly CatalogType[]
  /** Clears attempt bookkeeping and asks every source to reconnect. */
  retry: () => void
}

interface BootstrapState {
  runId: number
  phases: Partial<Record<CatalogType, BootstrapPhase | 'done'>>
  running: boolean
  error: string | null
  partialError: string | null
}

type BootstrapAction =
  | { kind: 'start'; runId: number }
  | { kind: 'phase'; runId: number; type: CatalogType; phase: BootstrapPhase | 'done' }
  | { kind: 'finish'; runId: number; error: string | null; partialError: string | null }
  | { kind: 'reset' }

const INITIAL_STATE: BootstrapState = { runId: 0, phases: {}, running: false, error: null, partialError: null }

/** Actions of a run that was superseded are ignored, so it cannot clear the state of the run that replaced it. */
export function bootstrapReducer(state: BootstrapState, action: BootstrapAction): BootstrapState {
  switch (action.kind) {
    case 'start':
      return { runId: action.runId, phases: {}, running: true, error: null, partialError: null }
    case 'phase':
      if (action.runId !== state.runId) return state
      return { ...state, phases: { ...state.phases, [action.type]: action.phase } }
    case 'finish':
      if (action.runId !== state.runId) return state
      return { ...state, phases: {}, running: false, error: action.error, partialError: action.partialError }
    case 'reset':
      return { ...INITIAL_STATE, runId: state.runId }
  }
}

interface ActiveRun {
  key: string
  id: number
  controller: AbortController
  /** Finished with every type failed: a later sign-in of the source tries again. */
  failed: boolean
}

function credentialsKey(creds: XtreamCredentials | null): string | null {
  return creds ? `${creds.url}\n${creds.username}\n${creds.password}` : null
}

/**
 * Loads just enough of the active Xtream source to fill the dashboard (per
 * type: categories, then a small preview), then starts the full catalog sync
 * in the background.
 *
 * Runs as soon as the source's credentials are known, alongside the sign-in
 * request instead of after it. A run is restarted only by what changes its
 * result: another source, other credentials, a refresh of the source (new
 * catalog revision) or "Yeniden Dene". The sign-in completing does not
 * restart it, but it does retry a run that failed entirely (the provider was
 * down and is back).
 */
export function useHomeBootstrap(): HomeBootstrap {
  const activeSourceId = useStore((s) => s.activeSourceId)
  const sourceType = useStore((s) => s.sources.find((source) => source.id === s.activeSourceId)?.type ?? null)
  const credsKey = useStore((s) => (s.activeSourceId ? credentialsKey(s.getXtreamCredentials(s.activeSourceId)) : null))
  const isSourceComplete = useStore((s) => sourceCatalogComplete(s.catalogStatus, activeSourceId))
  const isAuthed = useStore((s) => !!(activeSourceId && s.xtreamAuth[activeSourceId]))
  // The cached catalog is read first; a preview it is about to supply is not requested.
  const cacheSettled = useCatalogCacheSettled(activeSourceId)
  const offlineSince = useStore((s) =>
    offlineCopySince(s.catalogStatus, activeSourceId, !!(activeSourceId && s.sourceErrors[activeSourceId]))
  )
  const setPlaylistLoading = useStore((s) => s.setPlaylistLoading)
  const replaceSourceCatalog = useStore((s) => s.replaceSourceCatalog)
  const requestSourceReconnect = useStore((s) => s.requestSourceReconnect)

  const [state, dispatch] = useReducer(bootstrapReducer, INITIAL_STATE)
  const [reloadToken, bumpReloadToken] = useReducer((value: number) => value + 1, 0)
  const runRef = useRef<ActiveRun | null>(null)
  const runCounterRef = useRef(0)

  useEffect(() => {
    const eligible = !!activeSourceId && sourceType === 'xtream' && !!credsKey
    const key = eligible
      ? `${activeSourceId}#${defaultCatalog.getSourceRevision(activeSourceId)}#${credsKey}#${reloadToken}`
      : null

    const current = runRef.current
    if (current && current.key === key && !(current.failed && isAuthed)) return
    if (current && current.key !== key) {
      // Another source, other credentials, a refresh or a retry: the old run's
      // results no longer apply.
      current.controller.abort()
      runRef.current = null
      dispatch({ kind: 'reset' })
      setPlaylistLoading(false)
    }
    if (!key || !activeSourceId || isSourceComplete || !cacheSettled) return
    const sourceId = activeSourceId

    const creds = useStore.getState().getXtreamCredentials(sourceId)
    if (!creds) return

    runCounterRef.current += 1
    const run: ActiveRun = { key, id: runCounterRef.current, controller: new AbortController(), failed: false }
    runRef.current = run
    const isCurrent = () => runRef.current === run

    const types = CATALOG_TYPES.filter((type) => !defaultCatalog.getStatus(sourceId, type)?.loaded)
    dispatch({ kind: 'start', runId: run.id })
    setPlaylistLoading(true)

    void (async () => {
      let summary: BootstrapSummary = { allFailed: false, failures: [], cancelled: false }
      try {
        const outcomes = await runHomeBootstrap({
          sourceId,
          creds,
          types,
          signal: run.controller.signal,
          onPhase: (type, phase) => dispatch({ kind: 'phase', runId: run.id, type, phase })
        })
        summary = summarizeBootstrap(outcomes, { othersLoaded: types.length < CATALOG_TYPES.length })
      } finally {
        if (isCurrent()) {
          run.failed = summary.allFailed
          dispatch({
            kind: 'finish',
            runId: run.id,
            error: summary.allFailed ? summary.failures[0]?.message ?? text.loadFailed : null,
            partialError: summary.allFailed ? null : partialFailureMessage(summary.failures)
          })
          setPlaylistLoading(false)
        }
      }
      // A run that loaded something hands over to the full sync, which keeps
      // going when the page is left.
      if (isCurrent() && !summary.allFailed && !summary.cancelled) void ensureStagedSync(sourceId, 'live', creds)
    })()
  }, [activeSourceId, sourceType, credsKey, isSourceComplete, isAuthed, reloadToken, cacheSettled, setPlaylistLoading])

  // A cached copy whose refresh failed (the provider was down at start) is
  // refreshed again once the sign-in gets through.
  useEffect(() => {
    if (!isAuthed || !activeSourceId) return
    const failed = CATALOG_TYPES.some((type) => {
      const status = defaultCatalog.getStatus(activeSourceId, type)
      return status?.fromCache && status.error && !status.syncing
    })
    const creds = useStore.getState().getXtreamCredentials(activeSourceId)
    if (failed && creds) void ensureStagedSync(activeSourceId, 'live', creds)
  }, [isAuthed, activeSourceId])

  // `isLoadingPlaylist` lives in the global store, so it must be released when
  // the page goes away mid-run; otherwise it pins the loader on later visits.
  useEffect(
    () => () => {
      runRef.current?.controller.abort()
      runRef.current = null
      setPlaylistLoading(false)
    },
    [setPlaylistLoading]
  )

  const retry = useCallback(() => {
    const state = useStore.getState()
    const sourceId = state.activeSourceId
    const creds = sourceId ? state.getXtreamCredentials(sourceId) : null
    // Only an Xtream source is loaded by the bootstrap. Invalidating an M3U
    // source would throw away the playlist it is downloading, and nothing
    // here would load it again: its connection attempt carries on instead.
    if (sourceId && creds) {
      // Keeps what is on screen, cancels running syncs and marks the lists
      // incomplete; the new revision lets the bootstrap and the full sync run
      // again, and they ask the panel, not the request cache.
      forgetXtreamRequests(creds)
      replaceSourceCatalog(sourceId, null)
    }
    requestSourceReconnect()
    bumpReloadToken()
  }, [replaceSourceCatalog, requestSourceReconnect])

  const loadingTypes = CATALOG_TYPES.filter((type) => {
    const phase = state.phases[type]
    return phase === 'categories' || phase === 'preview'
  })

  return {
    error: state.error,
    partialError: state.partialError ?? (offlineSince !== null ? offlineCopyMessage(offlineSince) : null),
    isBootstrapping: state.running,
    stage: bootstrapStageOf(state.phases, state.running),
    loadingTypes,
    retry
  }
}
