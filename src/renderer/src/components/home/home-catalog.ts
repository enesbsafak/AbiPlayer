import type { Channel } from '@/types/playlist'

export const HOME_MAX_LIVE = 12
export const HOME_MAX_OTHER = 6

export interface HomeCatalog {
  /** Everything the active source lists after the catalog view, for the hero count. */
  visibleCount: number
  /** Whether the active source has any channels at all, hidden or not. */
  hasSourceContent: boolean
  recentLive: Channel[]
  recentVod: Channel[]
  recentSeries: Channel[]
}

/** The active source's lists after the catalog view (`useVisibleCatalogItems`). */
export interface HomeCatalogInput {
  live: readonly Channel[]
  vod: readonly Channel[]
  series: readonly Channel[]
  /** Items held for the source before any view rule. */
  totalCount: number
}

/**
 * The dashboard rows lead to "Tümünü Gör", which lists the active source only,
 * so the dashboard is scoped the same way and built from the same catalog
 * view. Mixing every source, and counting hidden categories, made the count and
 * the rows disagree with the page one click away.
 *
 * The view already puts adult content last (or drops it), so the first few of
 * each list are what the rows show: an M3U playlist that opens with its adult
 * groups used to fill every row here.
 */
export function buildHomeCatalog(input: HomeCatalogInput): HomeCatalog {
  return {
    visibleCount: input.live.length + input.vod.length + input.series.length,
    hasSourceContent: input.totalCount > 0,
    recentLive: input.live.slice(0, HOME_MAX_LIVE),
    recentVod: input.vod.slice(0, HOME_MAX_OTHER),
    recentSeries: input.series.slice(0, HOME_MAX_OTHER)
  }
}
