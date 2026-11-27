import type { CatalogItem } from '@/catalog/types'
import { findCurrentProgram, channelPrograms, normalizeEpgChannelKey } from '@/services/epg-service'
import type { EPGData } from '@/types/epg'
import type { Channel } from '@/types/playlist'
import type { ContinueWatchingItem } from '@/services/watch-progress'
import type { SectionKey } from '@/theme/palette'
import { strings } from '@/strings'

const text = strings.catalog.home

/** Items a home row (films, series) can show at most; it shows as many as fit. */
export const HOME_MAX_FILMS = 24

export interface Newest<T> {
  items: T[]
  /** The list carries dates (Xtream), so these are the newest; otherwise its first entries (M3U). */
  dated: boolean
}

/**
 * The `limit` newest of `items` by `dateOf`, newest first, in one pass. Items
 * `exclude` rejects are skipped. A list without any dates gives its first
 * entries in its own order, and says so (`dated: false`), so the screen does
 * not call them "son eklenen".
 */
export function pickNewest<T>(
  items: readonly T[],
  dateOf: (item: T) => number | undefined,
  limit: number,
  exclude: (item: T) => boolean = () => false
): Newest<T> {
  const top: Array<{ item: T; date: number }> = []
  const firstUndated: T[] = []
  for (const item of items) {
    if (exclude(item)) continue
    const date = dateOf(item)
    if (date === undefined || !Number.isFinite(date)) {
      if (firstUndated.length < limit) firstUndated.push(item)
      continue
    }
    if (top.length === limit && date <= top[top.length - 1]!.date) continue
    // Insertion keeps it sorted, newest first; equal dates keep list order.
    let index = top.length
    while (index > 0 && top[index - 1]!.date < date) index -= 1
    top.splice(index, 0, { item, date })
    if (top.length > limit) top.pop()
  }
  if (top.length > 0) return { items: top.map((entry) => entry.item), dated: true }
  return { items: firstUndated, dated: false }
}

export interface HomeCatalog {
  /** Everything the active source lists after the catalog view. */
  visibleCount: number
  /** Whether the active source has any channels at all, hidden or not. */
  hasSourceContent: boolean
  counts: Record<'live' | 'vod' | 'series', number>
  films: Newest<CatalogItem>
  /** The most recently updated series: the Diziler tile and the series row. */
  newestSeries: Newest<CatalogItem>
}

/** The active source's lists after the catalog view (`useVisibleCatalogItems`). */
export interface HomeCatalogInput {
  live: readonly CatalogItem[]
  vod: readonly CatalogItem[]
  series: readonly CatalogItem[]
  /** Items held for the source before any view rule. */
  totalCount: number
  /**
   * Adult categories of the source. The view lists adult content last (or
   * not at all); re-sorting by date must not pull it to the front.
   */
  adultCategoryIds?: ReadonlySet<string>
}

/**
 * The home screen is scoped to the active source, as the pages its tiles open
 * are, and built from the same catalog view, so a count or a title on a tile
 * never disagrees with the page one click away.
 */
export function buildHomeCatalog(input: HomeCatalogInput): HomeCatalog {
  const adultCategories = input.adultCategoryIds ?? new Set<string>()
  const isAdult = (item: CatalogItem) => item.isAdult || (!!item.categoryId && adultCategories.has(item.categoryId))
  return {
    visibleCount: input.live.length + input.vod.length + input.series.length,
    hasSourceContent: input.totalCount > 0,
    counts: { live: input.live.length, vod: input.vod.length, series: input.series.length },
    films: pickNewest(input.vod, (item) => item.added, HOME_MAX_FILMS, isAdult),
    newestSeries: pickNewest(input.series, (item) => item.lastModified, HOME_MAX_FILMS, isAdult)
  }
}

/** What the guide says about the channels the viewer is likely to care about. */
export interface GuideHighlights {
  /** A programme on air now. */
  now: { title: string; channel: string } | null
  /** The next programme to start. */
  next: { start: number; title: string; channel: string } | null
}

/** Channels looked at, at most: the guide is only read, never loaded, for the home screen. */
const GUIDE_SCAN_LIMIT = 300

/**
 * The first programme on air and the first one about to start, over
 * `channels` in order (favourites first, then the list as the provider orders
 * it). Null when there is no guide for the source in memory.
 */
export function findGuideHighlights(
  guide: EPGData | null,
  channels: readonly Channel[],
  now: number
): GuideHighlights | null {
  if (!guide) return null
  let current: GuideHighlights['now'] = null
  let next: GuideHighlights['next'] = null
  let scanned = 0
  for (const channel of channels) {
    if (scanned >= GUIDE_SCAN_LIMIT || (current && next)) break
    scanned += 1
    const programs = channelPrograms(guide.programs, channel)
    if (!programs || programs.length === 0) continue
    if (!current) {
      const onAir = findCurrentProgram(programs, now)
      if (onAir) current = { title: onAir.title, channel: channel.name }
    }
    if (!next) {
      const upcoming = programs.find((program) => program.start > now)
      if (upcoming) next = { start: upcoming.start, title: upcoming.title, channel: channel.name }
    }
  }
  return { now: current, next }
}

/** Where the active source stands, as far as the tiles care. */
export type HomeSourceState = 'none' | 'loading' | 'failed' | 'ready'

export interface TileInput {
  source: HomeSourceState
  counts: Record<'live' | 'vod' | 'series', number>
  /** The type's list is in (complete or a preview), so a count of 0 means empty. */
  loaded: Record<'live' | 'vod' | 'series', boolean>
  films: Newest<CatalogItem>
  newestSeries: Newest<CatalogItem>
  guide: GuideHighlights | null
  /** Channels of the list that have programmes in the guide; null without a guide in memory. */
  guideChannels: number | null
  formatTime: (epochMs: number) => string
}

export interface TileLine {
  /** The count (or, before there is one, a plain helpful line). */
  text: string
  /** A quieter second line, shown where the tile has room: the newest title, what is on now. */
  detail?: string
  /** Still waiting for the list; the tile says so to assistive technology too. */
  busy: boolean
}

/**
 * What each destination tile says: the count the user can see in that
 * section (hidden categories left out, as the section does), and under it,
 * where there is room, one specific line. Before a list is in, or when it is
 * empty, a plain helpful line instead of "0 film". Nothing here is made up:
 * every line names a count, a title or a programme the source actually has.
 */
export function describeTiles(input: TileInput): Record<SectionKey, TileLine> {
  const fallback = (type: 'live' | 'vod' | 'series'): TileLine => {
    if (input.source === 'none') return { text: text.tiles.noSource, busy: false }
    if (input.loaded[type]) return { text: text.tiles.empty(strings.catalog.types[type].noun), busy: false }
    if (input.source === 'failed') return { text: text.tiles.waiting, busy: false }
    return { text: text.tiles.loading, busy: true }
  }

  const live: TileLine =
    input.counts.live > 0
      ? {
          text: text.tiles.liveCount(input.counts.live),
          detail: input.guide?.now ? text.tiles.liveNow(input.guide.now.title, input.guide.now.channel) : undefined,
          busy: false
        }
      : fallback('live')

  const next = input.guide?.next
  const nextLine = next ? text.tiles.guideNext(input.formatTime(next.start), next.title, next.channel) : undefined
  let epg: TileLine
  if (input.source === 'none') epg = { text: text.tiles.noSource, busy: false }
  else if (input.guideChannels) epg = { text: text.tiles.guideCount(input.guideChannels), detail: nextLine, busy: false }
  else if (nextLine) epg = { text: nextLine, busy: false }
  else epg = { text: text.tiles.guideIdle, busy: false }

  const newestFilm = input.films.dated ? input.films.items[0] : undefined
  const vod: TileLine =
    input.counts.vod > 0
      ? {
          text: text.tiles.vodCount(input.counts.vod),
          detail: newestFilm ? text.tiles.vodNewest(newestFilm.name) : undefined,
          busy: false
        }
      : fallback('vod')

  const newestSeries = input.newestSeries.dated ? input.newestSeries.items[0] : undefined
  const series: TileLine =
    input.counts.series > 0
      ? {
          text: text.tiles.seriesCount(input.counts.series),
          detail: newestSeries ? text.tiles.seriesNewest(newestSeries.name) : undefined,
          busy: false
        }
      : fallback('series')

  return { live, epg, vod, series }
}

/** Channels of `channels` with programmes in the guide; null without a guide. */
export function countGuideChannels(guide: EPGData | null, channels: readonly Channel[]): number | null {
  if (!guide) return null
  let count = 0
  for (const channel of channels) {
    const key = normalizeEpgChannelKey(channel.epgChannelId)
    if (key && (guide.programs[key]?.length ?? 0) > 0) count += 1
  }
  return count
}

export interface ContinueDetails {
  /** "Film · 2024 · 1 sa 52 dk". */
  meta: string
  /** Share watched, 0–100. */
  percent: number
  remaining: string
}

/** The continue tile's line of facts and its progress, from what the history stored. */
export function describeContinue(item: ContinueWatchingItem): ContinueDetails {
  const { entry, channel } = item
  const duration = entry.duration > 0 ? entry.duration : 0
  const percent = duration > 0 ? Math.min(100, Math.max(0, Math.round((entry.position / duration) * 100))) : 0
  // An episode is shown as a film-like item (seekable, resumable); its target says what it is.
  const isEpisode = item.target.kind === 'episode' || channel.type === 'series'
  const parts = [isEpisode ? text.kindEpisode : text.kindFilm]
  if (channel.year) parts.push(channel.year)
  if (duration > 0) parts.push(text.duration(Math.round(duration / 60)))
  return {
    meta: parts.join(' · '),
    percent,
    remaining: text.remaining(Math.max(0, Math.round((duration - entry.position) / 60)))
  }
}
