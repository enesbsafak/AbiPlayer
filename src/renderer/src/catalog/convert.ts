import { isAdultLabel } from '@/services/adult-content'
import { parseXtreamTimestamp } from '@/services/xtream-normalize'
import type { Category, Channel } from '@/types/playlist'
import type {
  XtreamCategory,
  XtreamLiveStream,
  XtreamSeriesStream,
  XtreamVODStream
} from '@/types/xtream'
import { normalizeSearchKey } from './normalize'
import {
  CATALOG_TYPES,
  type CatalogCategory,
  type CatalogItem,
  type CatalogType,
  type SourceCatalogReplacement
} from './types'

/*
 * Plain data in, plain records out: nothing here touches the network, the DOM
 * or a store, so the same functions can run in a worker.
 */

export function xtreamItemId(sourceId: string, type: CatalogType, providerId: number | string): string {
  return `${sourceId}_${type}_${providerId}`
}

export function xtreamCategoryId(sourceId: string, type: CatalogType, providerCategoryId: string): string {
  return `${sourceId}_${type}_${providerCategoryId}`
}

export function xtreamCategoriesToRecords(
  categories: readonly XtreamCategory[],
  sourceId: string,
  type: CatalogType
): CatalogCategory[] {
  return categories.map((category) => ({
    id: xtreamCategoryId(sourceId, type, category.category_id),
    name: category.category_name,
    sourceId,
    type,
    isAdult: isAdultLabel(category.category_name)
  }))
}

export function xtreamLiveToRecords(streams: readonly XtreamLiveStream[], sourceId: string): CatalogItem[] {
  return streams.map((s) => {
    const record: CatalogItem = {
      id: xtreamItemId(sourceId, 'live', s.stream_id),
      name: s.name,
      streamUrl: '',
      streamId: s.stream_id,
      sourceId,
      type: 'live',
      searchName: normalizeSearchKey(s.name),
      // Plenty of providers never populate is_adult, so fall back to the name.
      isAdult: s.is_adult || isAdultLabel(s.name)
    }
    if (s.stream_icon) record.logo = s.stream_icon
    if (s.category_id) record.categoryId = xtreamCategoryId(sourceId, 'live', s.category_id)
    if (s.epg_channel_id) record.epgChannelId = s.epg_channel_id
    if (s.tv_archive) {
      record.tvArchive = true
      record.tvArchiveDuration = s.tv_archive_duration
    }
    const added = parseXtreamTimestamp(s.added)
    if (added !== null) record.added = added
    return record
  })
}

export function xtreamVodToRecords(streams: readonly XtreamVODStream[], sourceId: string): CatalogItem[] {
  return streams.map((s) => {
    const record: CatalogItem = {
      id: xtreamItemId(sourceId, 'vod', s.stream_id),
      name: s.name,
      streamUrl: '',
      streamId: s.stream_id,
      sourceId,
      type: 'vod',
      // Playback needs it; the panel default is mp4.
      containerExtension: s.container_extension || 'mp4',
      searchName: normalizeSearchKey(s.name),
      isAdult: s.is_adult || isAdultLabel(s.name)
    }
    if (s.stream_icon) record.logo = s.stream_icon
    if (s.category_id) record.categoryId = xtreamCategoryId(sourceId, 'vod', s.category_id)
    if (s.rating) record.rating = s.rating
    const added = parseXtreamTimestamp(s.added)
    if (added !== null) record.added = added
    return record
  })
}

export function xtreamSeriesToRecords(streams: readonly XtreamSeriesStream[], sourceId: string): CatalogItem[] {
  return streams.map((s) => {
    const record: CatalogItem = {
      id: xtreamItemId(sourceId, 'series', s.series_id),
      name: s.name,
      streamUrl: '',
      seriesId: s.series_id,
      sourceId,
      type: 'series',
      searchName: normalizeSearchKey(s.name),
      // XtreamSeriesStream carries no is_adult field at all: name only.
      isAdult: isAdultLabel(s.name)
    }
    if (s.cover) record.logo = s.cover
    if (s.category_id) record.categoryId = xtreamCategoryId(sourceId, 'series', s.category_id)
    if (s.rating) record.rating = s.rating
    const lastModified = parseXtreamTimestamp(s.last_modified)
    if (lastModified !== null) record.lastModified = lastModified
    return record
  })
}

/**
 * A parsed M3U entry as a record. The entry keeps its URL (its identity) and
 * gets no `streamId`, or playback would read it as an Xtream item.
 */
export function m3uEntryToRecord(entry: Channel): CatalogItem {
  const record: CatalogItem = {
    id: entry.id,
    name: entry.name,
    streamUrl: entry.streamUrl,
    sourceId: entry.sourceId,
    type: entry.type,
    searchName: normalizeSearchKey(entry.name),
    isAdult: entry.isAdult === true
  }
  if (entry.logo) record.logo = entry.logo
  if (entry.categoryId) record.categoryId = entry.categoryId
  if (entry.epgChannelId) record.epgChannelId = entry.epgChannelId
  if (entry.httpHeaders) record.httpHeaders = entry.httpHeaders
  if (entry.m3uEpisodes) record.m3uEpisodes = entry.m3uEpisodes
  if (entry.epgShiftHours) record.epgShiftHours = entry.epgShiftHours
  const group = entry.group || entry.categoryName
  if (group) {
    record.group = group
    record.categoryName = group
    record.searchGroup = normalizeSearchKey(group)
  }
  return record
}

export function categoryToRecord(category: Category): CatalogCategory {
  return {
    id: category.id,
    name: category.name,
    sourceId: category.sourceId,
    type: category.type,
    isAdult: isAdultLabel(category.name)
  }
}

/** A parsed M3U playlist as complete lists for each of the three types. */
export function m3uPlaylistToReplacement(parsed: {
  channels: readonly Channel[]
  categories: readonly Category[]
}): SourceCatalogReplacement {
  const items: Record<CatalogType, CatalogItem[]> = { live: [], vod: [], series: [] }
  const categories: Record<CatalogType, CatalogCategory[]> = { live: [], vod: [], series: [] }

  for (const channel of parsed.channels) items[channel.type].push(m3uEntryToRecord(channel))
  for (const category of parsed.categories) categories[category.type].push(categoryToRecord(category))

  const replacement: SourceCatalogReplacement = {}
  for (const type of CATALOG_TYPES) {
    replacement[type] = { items: items[type], categories: categories[type] }
  }
  return replacement
}
