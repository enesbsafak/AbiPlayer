import type { CatalogStatus, CatalogType } from '@/catalog/types'
import { formatDateTime, strings } from '@/strings'

/**
 * Pure parts of the catalog page model: which banner the status calls for,
 * and the route state a catalog page is restored from (returning from the
 * player, or opened from another page).
 */

export type CatalogBanner =
  /** The source cannot load anything: its secret is missing. Says why; the fix is in the source settings. */
  | { kind: 'source-error'; message: string }
  /** A foreground load (preview list or the selected category) failed. */
  | { kind: 'load-error'; message: string }
  /** A copy from the disk cache is shown and the provider could not be reached. */
  | { kind: 'offline'; since: number; retryable: boolean }
  /** The full list failed: what is shown is all there is until a retry. */
  | { kind: 'sync-error'; message: string; retryable: boolean; partial: boolean }
  /** A preview (or the part fetched so far) is shown; the full list is loading or about to. */
  | { kind: 'partial'; syncing: boolean }

export interface CatalogBannerInput {
  /** Only Xtream sources load in stages; M3U lists are complete on import. */
  isXtream: boolean
  /** A category is selected (not "all"). */
  hasCategory: boolean
  /** The selected category is in memory as a whole. */
  categoryLoaded: boolean
  status: CatalogStatus | null
  loadError: string | null
  /** Why the source cannot load at all (its secret is missing), or null. */
  sourceError?: string | null
  /** The source failed to connect (an M3U playlist could not be fetched, a sign-in failed). */
  connectionFailed?: boolean
}

/** The offline banner's text: when the copy shown was fetched. */
export function offlineCopyBannerText(since: number): string {
  return strings.catalog.page.offlineBanner(formatDateTime(since))
}

/**
 * One banner at a time, the most urgent first. A failure always replaces the
 * calm "loading in the background" banner; that one only shows while the full
 * list may still arrive. A fully loaded category needs no banner: what it
 * shows is complete whatever happened to the full list. A list served from
 * the disk cache is complete too, but while its refresh fails (or the source
 * cannot connect) the page says that it is an offline copy and how old.
 */
export function catalogBanner(input: CatalogBannerInput): CatalogBanner | null {
  const { isXtream, hasCategory, categoryLoaded, status, loadError } = input
  if (input.sourceError) return { kind: 'source-error', message: input.sourceError }
  if (loadError) return { kind: 'load-error', message: loadError }
  if (status?.fromCache && status.fetchedAt && (status.error || input.connectionFailed)) {
    return { kind: 'offline', since: status.fetchedAt, retryable: status.error ? status.error.retryable : true }
  }
  if (!isXtream || status?.complete) return null
  if (hasCategory && categoryLoaded) return null
  if (status?.error) {
    return {
      kind: 'sync-error',
      message: status.error.message,
      retryable: status.error.retryable,
      partial: status.count > 0
    }
  }
  if (hasCategory) return null
  return { kind: 'partial', syncing: status?.syncing === true }
}

/** An open detail view: a film, or a series and the season shown. */
export interface CatalogDetailRef {
  itemId: string
  sourceId: string
  seriesId?: number
  season?: number
}

/** What a catalog page hands the player to come back to. */
export interface CatalogRouteState {
  restoreSearchQuery?: string
  restoreScrollTop?: number
  /** The card to focus again (the one played, or the one whose detail was open). */
  restoreFocusItemId?: string
  restoreDetail?: CatalogDetailRef
}

export interface CatalogRestore {
  searchQuery?: string
  scrollTop?: number
  focusItemId?: string
  detail?: CatalogDetailRef
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseDetail(raw: unknown): CatalogDetailRef | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.itemId !== 'string' || !raw.itemId || typeof raw.sourceId !== 'string') return undefined
  const seriesId = finiteNumber(raw.seriesId)
  const season = finiteNumber(raw.season)
  return {
    itemId: raw.itemId,
    sourceId: raw.sourceId,
    ...(seriesId !== undefined ? { seriesId } : {}),
    ...(season !== undefined ? { season } : {})
  }
}

/**
 * Reads route state for a catalog page of `type`. Besides its own shape it
 * accepts what other screens send: `restoreSelectedSeries` (home, favourites,
 * search open a series this way). Returns null when there is nothing to
 * restore, so the caller leaves the history entry alone.
 */
export function parseCatalogRouteState(state: unknown, type: CatalogType): CatalogRestore | null {
  if (!isRecord(state)) return null
  const restore: CatalogRestore = {}

  if (typeof state.restoreSearchQuery === 'string') restore.searchQuery = state.restoreSearchQuery
  const scrollTop = finiteNumber(state.restoreScrollTop)
  if (scrollTop !== undefined && scrollTop >= 0) restore.scrollTop = scrollTop
  if (typeof state.restoreFocusItemId === 'string' && state.restoreFocusItemId) restore.focusItemId = state.restoreFocusItemId

  let detail = parseDetail(state.restoreDetail)
  if (!detail && type === 'series' && isRecord(state.restoreSelectedSeries)) {
    const legacy = state.restoreSelectedSeries
    const seriesId = finiteNumber(legacy.seriesId)
    if (seriesId !== undefined && typeof legacy.sourceId === 'string') {
      const season = finiteNumber(legacy.seasonNumber)
      detail = {
        itemId: `${legacy.sourceId}_series_${seriesId}`,
        sourceId: legacy.sourceId,
        seriesId,
        ...(season !== undefined ? { season } : {})
      }
    }
  }
  // A series detail can only be opened with its provider id.
  if (detail && type === 'series' && detail.seriesId === undefined) detail = undefined
  if (detail) restore.detail = detail

  return Object.keys(restore).length > 0 ? restore : null
}

/** The route state for the player to hand back; the inverse of `parseCatalogRouteState`. */
export function buildCatalogRouteState(view: {
  searchQuery: string
  scrollTop: number
  focusItemId: string | null
  detail: CatalogDetailRef | null
}): CatalogRouteState {
  return {
    restoreSearchQuery: view.searchQuery,
    restoreScrollTop: Math.max(0, Math.round(view.scrollTop)),
    ...(view.focusItemId ? { restoreFocusItemId: view.focusItemId } : {}),
    ...(view.detail ? { restoreDetail: view.detail } : {})
  }
}

/** The provider's category id in a catalog category id (`<source>_<type>_<id>`), or null. */
export function providerCategoryId(sourceId: string | null, type: CatalogType, categoryId: string | null): string | null {
  if (!sourceId || !categoryId) return null
  const prefix = `${sourceId}_${type}_`
  return categoryId.startsWith(prefix) ? categoryId.slice(prefix.length) : null
}
