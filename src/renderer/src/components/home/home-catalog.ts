import { applyCatalogView, type CatalogViewOptions } from '@/services/catalog-view'
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

/**
 * The dashboard rows lead to "Tümünü Gör", which lists the active source only,
 * so the dashboard is scoped the same way and filtered with the same catalog
 * view. Mixing every source, and counting hidden categories, made the count and
 * the rows disagree with the page one click away.
 */
export function buildHomeCatalog(
  channels: Channel[],
  activeSourceId: string | null,
  catalogView: CatalogViewOptions
): HomeCatalog {
  const sourceChannels = activeSourceId
    ? channels.filter((channel) => channel.sourceId === activeSourceId)
    : channels
  const visible = applyCatalogView(sourceChannels, catalogView)

  const recentLive: Channel[] = []
  const recentVod: Channel[] = []
  const recentSeries: Channel[] = []

  // The dashboard shows the first few of each type, so it is the screen the
  // catalog order hits hardest — an M3U playlist that opens with its adult
  // groups used to fill every row here.
  for (const channel of visible) {
    if (recentLive.length < HOME_MAX_LIVE && channel.type === 'live') recentLive.push(channel)
    if (recentVod.length < HOME_MAX_OTHER && channel.type === 'vod') recentVod.push(channel)
    if (recentSeries.length < HOME_MAX_OTHER && channel.type === 'series') recentSeries.push(channel)

    if (
      recentLive.length >= HOME_MAX_LIVE &&
      recentVod.length >= HOME_MAX_OTHER &&
      recentSeries.length >= HOME_MAX_OTHER
    ) {
      break
    }
  }

  return {
    visibleCount: visible.length,
    hasSourceContent: sourceChannels.length > 0,
    recentLive,
    recentVod,
    recentSeries
  }
}
