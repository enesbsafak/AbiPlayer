const EMPTY_SOURCE_KEY = '__no_source__'
const ALL_CATEGORIES_KEY = '__all__'

export function buildCatalogRetainResetKey(
  sourceId: string | null | undefined,
  categoryId: string | null | undefined
): string {
  return `${sourceId ?? EMPTY_SOURCE_KEY}:${categoryId ?? ALL_CATEGORIES_KEY}`
}
