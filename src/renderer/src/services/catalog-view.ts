import type { Category, Channel } from '@/types/playlist'
import { isAdultLabel } from './adult-content'

const EMPTY_SOURCE_KEY = '__no_source__'
const ALL_CATEGORIES_KEY = '__all__'

export function buildCatalogRetainResetKey(
  sourceId: string | null | undefined,
  categoryId: string | null | undefined
): string {
  return `${sourceId ?? EMPTY_SOURCE_KEY}:${categoryId ?? ALL_CATEGORIES_KEY}`
}

export interface CatalogViewOptions {
  /** Categories the user hid; their channels are dropped entirely. */
  hiddenCategoryIds: Set<string>
  /** Categories whose name reads as adult content — see collectAdultCategoryIds. */
  adultCategoryIds: Set<string>
}

function isAdultChannel(channel: Channel, adultCategoryIds: Set<string>): boolean {
  if (channel.isAdult) return true
  return !!channel.categoryId && adultCategoryIds.has(channel.categoryId)
}

/**
 * Apply the user's catalog preferences to a channel list: drop hidden
 * categories and push adult content to the end.
 *
 * Provider order is preserved otherwise. It carries real meaning — Turkish
 * providers list the national channels first — which an A-Z sort destroys by
 * scattering them between foreign channels. The only part of that order worth
 * overriding is "adult groups first", which is what plenty of M3U playlists
 * ship and what nobody actually asked for.
 *
 * Both partitions keep their relative provider order, so this is a stable
 * partition rather than a sort.
 */
export function applyCatalogView(channels: Channel[], options: CatalogViewOptions): Channel[] {
  const { hiddenCategoryIds, adultCategoryIds } = options

  const clean: Channel[] = []
  const adult: Channel[] = []

  for (const channel of channels) {
    if (channel.categoryId && hiddenCategoryIds.has(channel.categoryId)) continue
    if (isAdultChannel(channel, adultCategoryIds)) adult.push(channel)
    else clean.push(channel)
  }

  if (adult.length === 0) return clean
  return clean.concat(adult)
}

export interface CategoryViewOptions {
  hiddenCategoryIds: Set<string>
  /**
   * Keep hidden categories in the result. Only the settings screen wants this —
   * it has to list them to offer them back.
   */
  includeHidden?: boolean
}

/** Same rules as applyCatalogView, for the category sidebar. */
export function applyCategoryView(
  categories: Category[],
  options: CategoryViewOptions
): Category[] {
  const { hiddenCategoryIds, includeHidden = false } = options

  const clean: Category[] = []
  const adult: Category[] = []

  for (const category of categories) {
    if (!includeHidden && hiddenCategoryIds.has(category.id)) continue
    if (isAdultLabel(category.name)) adult.push(category)
    else clean.push(category)
  }

  if (adult.length === 0) return clean
  return clean.concat(adult)
}
