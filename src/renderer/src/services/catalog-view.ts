import type { Category, Channel } from '@/types/playlist'
import type { CatalogSortMode } from '@/types/settings'
import { isAdultLabel } from './adult-content'

const EMPTY_SOURCE_KEY = '__no_source__'
const ALL_CATEGORIES_KEY = '__all__'

export function buildCatalogRetainResetKey(
  sourceId: string | null | undefined,
  categoryId: string | null | undefined
): string {
  return `${sourceId ?? EMPTY_SOURCE_KEY}:${categoryId ?? ALL_CATEGORIES_KEY}`
}

// `numeric` is what keeps "TRT 2" ahead of "TRT 10" instead of sorting them as
// strings; `sensitivity: 'base'` makes case and diacritics irrelevant, so
// "Bein Sports" and "beIN SPORTS" don't end up in different places.
let collator: Intl.Collator | null = null
try {
  collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' })
} catch {
  collator = null
}

function compareByName(a: { name: string }, b: { name: string }): number {
  if (collator) return collator.compare(a.name, b.name)
  return a.name.localeCompare(b.name, 'tr')
}

export interface CatalogViewOptions {
  /** Categories the user hid; their channels are dropped entirely. */
  hiddenCategoryIds: Set<string>
  /** Categories whose name reads as adult content — see collectAdultCategoryIds. */
  adultCategoryIds: Set<string>
  sortMode: CatalogSortMode
}

function isAdultChannel(channel: Channel, adultCategoryIds: Set<string>): boolean {
  if (channel.isAdult) return true
  return !!channel.categoryId && adultCategoryIds.has(channel.categoryId)
}

/**
 * Apply the user's catalog preferences to a channel list: drop hidden
 * categories, push adult content to the end, then sort.
 *
 * Adult content moves last in BOTH sort modes. The provider's own order is a
 * legitimate preference, but "adult channels first" — which is what plenty of
 * M3U playlists ship — is not what anyone actually chose.
 */
export function applyCatalogView(channels: Channel[], options: CatalogViewOptions): Channel[] {
  const { hiddenCategoryIds, adultCategoryIds, sortMode } = options

  const clean: Channel[] = []
  const adult: Channel[] = []

  for (const channel of channels) {
    if (channel.categoryId && hiddenCategoryIds.has(channel.categoryId)) continue
    if (isAdultChannel(channel, adultCategoryIds)) adult.push(channel)
    else clean.push(channel)
  }

  if (sortMode === 'name') {
    clean.sort(compareByName)
    adult.sort(compareByName)
  }

  if (adult.length === 0) return clean
  return clean.concat(adult)
}

export interface CategoryViewOptions {
  hiddenCategoryIds: Set<string>
  sortMode: CatalogSortMode
  /**
   * Keep hidden categories in the result. Only the settings screen wants this —
   * it has to list them to offer them back.
   */
  includeHidden?: boolean
}

/** Same ordering rules as applyCatalogView, for the category sidebar. */
export function applyCategoryView(
  categories: Category[],
  options: CategoryViewOptions
): Category[] {
  const { hiddenCategoryIds, sortMode, includeHidden = false } = options

  const clean: Category[] = []
  const adult: Category[] = []

  for (const category of categories) {
    if (!includeHidden && hiddenCategoryIds.has(category.id)) continue
    if (isAdultLabel(category.name)) adult.push(category)
    else clean.push(category)
  }

  if (sortMode === 'name') {
    clean.sort(compareByName)
    adult.sort(compareByName)
  }

  if (adult.length === 0) return clean
  return clean.concat(adult)
}
