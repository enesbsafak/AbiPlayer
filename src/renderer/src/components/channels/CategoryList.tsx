import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, EyeOff } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { ROVING_INDEX_ATTR, useRovingFocus } from '@/components/catalog/useRovingFocus'
import {
  catalog,
  useCatalogCategories,
  useVisibleCatalogCategories,
  useVisibleCatalogItems,
  type CatalogType
} from '@/catalog'
import { formatCount, strings } from '@/strings'

const text = strings.catalog.categories

interface CategoryListProps {
  type: CatalogType
  sourceId: string | null
  selectedCategoryId: string | null
  onSelect: (categoryId: string | null) => void
  /** Label of the "all" entry. */
  allLabel: string
  /** The category list request failed: shown with a retry. */
  error?: string | null
  onRetry?: () => void
  /** Categories are being fetched and none is known yet. */
  loading?: boolean
}

/** A pill (44 px) and the gap under it. */
const ROW_HEIGHT = 52

/**
 * The categories as a column of pills, "all" first: the selected one is a
 * white pill with ink text, each with its real item count once the category
 * is in memory. Virtualized (a provider can list hundreds), with the arrow
 * keys moving between pills. A category can be hidden from here; Ayarlar
 * brings it back.
 */
export const CategoryList = memo(function CategoryList({
  type,
  sourceId,
  selectedCategoryId,
  onSelect,
  allLabel,
  error,
  onRetry,
  loading = false
}: CategoryListProps) {
  const hiddenCategoryIds = useStore((s) => s.hiddenCategoryIds)
  const toggleCategoryHidden = useStore((s) => s.toggleCategoryHidden)
  const allCategories = useCatalogCategories(sourceId, type)
  const categories = useVisibleCatalogCategories(sourceId, type)
  // Subscribes to the partition, so the counts follow every change of it.
  const visibleItems = useVisibleCatalogItems(sourceId, type)
  const hiddenCount = useMemo(
    () => allCategories.filter((category) => hiddenCategoryIds.has(category.id)).length,
    [allCategories, hiddenCategoryIds]
  )
  // A count only for a category whose items are all in memory: a preview
  // holds a few of each, and "3" for a category of 300 would be wrong.
  const counts = useMemo(() => {
    void visibleItems
    const result = new Map<string, number>()
    if (!sourceId) return result
    for (const category of categories) {
      if (catalog.isCategoryLoaded(sourceId, type, category.id)) {
        result.set(category.id, catalog.getCategoryItems(sourceId, type, category.id).length)
      }
    }
    return result
  }, [visibleItems, categories, sourceId, type])
  const allComplete = !!sourceId && catalog.getStatus(sourceId, type)?.complete === true

  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  // Row 0 is "all"; row n is categories[n - 1].
  const count = categories.length + 1

  // Stable between renders, or the virtualizer recomputes every row's position on each one.
  const getItemKey = useCallback(
    (index: number) => (index === 0 ? '__all__' : (categories[index - 1]?.id ?? index)),
    [categories]
  )
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT,
    getItemKey,
    overscan: 8
  })
  const reveal = useCallback((index: number) => virtualizer.scrollToIndex(index, { align: 'auto' }), [virtualizer])
  const pageRows = Math.max(1, Math.floor((scrollElement?.clientHeight ?? 400) / ROW_HEIGHT))
  const roving = useRovingFocus(listRef, { count, columns: 1, pageRows, reveal })
  const rows = virtualizer.getVirtualItems()
  const firstRendered = rows[0]?.index ?? 0
  const lastRendered = rows[rows.length - 1]?.index ?? 0
  const tabStop = roving.activeIndex >= firstRendered && roving.activeIndex <= lastRendered ? roving.activeIndex : firstRendered

  // No colour transition: a selection is a fill that is there at once, never
  // a grey half-way state between raised and white.
  const pill = (selected: boolean) =>
    `flex h-11 w-full min-w-0 items-center justify-between gap-2.5 rounded-full pl-[18px] pr-4 text-left text-base ${
      selected ? 'bg-white font-bold text-ink' : 'bg-raised font-medium text-white hover:bg-surface-800'
    }`
  const countClass = (selected: boolean) =>
    `shrink-0 text-[15px] font-bold tabular-nums ${selected ? 'text-ink' : 'text-surface-500'}`

  const renderRow = (index: number) => {
    const focus = { tabIndex: index === tabStop ? 0 : -1, [ROVING_INDEX_ATTR]: index }
    if (index === 0) {
      const selected = !selectedCategoryId
      const allCount = allComplete ? visibleItems.length : null
      return (
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selected}
          aria-label={allLabel}
          aria-describedby={allCount !== null ? `category-count-${type}-all` : undefined}
          className={pill(selected)}
          {...focus}
        >
          <span className="min-w-0 truncate">{allLabel}</span>
          {allCount !== null && (
            <span id={`category-count-${type}-all`} className={countClass(selected)}>
              <span className="sr-only">{text.count(allCount)}</span>
              <span aria-hidden="true">{formatCount(allCount)}</span>
            </span>
          )}
        </button>
      )
    }
    const category = categories[index - 1]
    if (!category) return null
    const selected = category.id === selectedCategoryId
    const itemCount = counts.get(category.id)
    const countId = `category-count-${type}-${index}`
    // The name alone is the pill's accessible name (it is what people say and
    // search for); the count is read after it as a description.
    return (
      <div className="group relative">
        <button
          type="button"
          onClick={() => onSelect(category.id)}
          aria-pressed={selected}
          aria-label={category.name}
          aria-describedby={itemCount !== undefined ? countId : undefined}
          title={category.name}
          className={pill(selected)}
          {...focus}
        >
          <span className="min-w-0 truncate">{category.name}</span>
          {itemCount !== undefined && (
            <span
              id={countId}
              className={`${countClass(selected)} group-focus-within:opacity-0 group-hover:opacity-0`}
            >
              <span className="sr-only">{text.count(itemCount)}</span>
              <span aria-hidden="true">{formatCount(itemCount)}</span>
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => toggleCategoryHidden(category.id)}
          tabIndex={index === tabStop ? 0 : -1}
          // Out of sight until the pill is hovered or focused, so the column
          // stays calm, but reachable by keyboard from the active pill.
          className={`absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 ${
            selected ? 'bg-ink text-white' : 'bg-ground text-surface-400 hover:text-white'
          }`}
          aria-label={text.hide(category.name)}
          title={text.hideTitle}
        >
          <EyeOff size={15} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={setScrollElement} className="-m-1.5 min-h-0 flex-1 overflow-y-auto p-1.5">
        <div
          ref={listRef}
          role="group"
          aria-label={text.label}
          className="relative w-full outline-none"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
          {...roving.containerProps}
        >
          {rows.map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              data-roving-cell={row.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-2"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {renderRow(row.index)}
            </div>
          ))}
        </div>
        {loading && categories.length === 0 && (
          <div className="flex items-center gap-2 px-2 py-2 text-sm text-surface-400">
            <Spinner size={14} />
            <span>{text.loading}</span>
          </div>
        )}
        {error && (
          <div role="alert" className="mt-2 rounded-card bg-raised p-4 text-sm leading-5 text-white">
            <p className="flex items-start gap-2 font-bold">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-coral" aria-hidden="true" />
              {text.loadFailed}
            </p>
            <p className="mt-1 text-surface-400">{error}</p>
            {onRetry && (
              <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
                {strings.common.retry}
              </Button>
            )}
          </div>
        )}
        {hiddenCount > 0 && <p className="mt-2 px-2 text-sm leading-5 text-surface-500">{text.hiddenHint(hiddenCount)}</p>}
      </div>
    </div>
  )
})
