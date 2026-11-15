import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, EyeOff, Folder, LayoutGrid } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { ClampText } from '@/components/ui'
import { Spinner } from '@/components/ui/Spinner'
import { ROVING_INDEX_ATTR, useRovingFocus } from '@/components/catalog/useRovingFocus'
import { useCatalogCategories, useVisibleCatalogCategories, type CatalogCategory, type CatalogType } from '@/catalog'

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

/** Two-line rows measure about this high; the virtualizer corrects it after render. */
const ROW_ESTIMATE = 40

/**
 * The category sidebar: "all" first, then every visible category, virtualized
 * (a provider can list hundreds) with the arrow keys moving between rows.
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
  const hiddenCount = useMemo(
    () => allCategories.filter((category) => hiddenCategoryIds.has(category.id)).length,
    [allCategories, hiddenCategoryIds]
  )
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  // Row 0 is "all"; row n is categories[n - 1].
  const count = categories.length + 1

  // Stable between renders, or the virtualizer recomputes every row's position on each one.
  const getItemKey = useCallback((index: number) => (index === 0 ? '__all__' : categories[index - 1].id), [categories])
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey,
    overscan: 8
  })
  const reveal = useCallback((index: number) => virtualizer.scrollToIndex(index, { align: 'auto' }), [virtualizer])
  const pageRows = Math.max(1, Math.floor((scrollElement?.clientHeight ?? 400) / ROW_ESTIMATE))
  const roving = useRovingFocus(listRef, { count, columns: 1, pageRows, reveal })
  const rows = virtualizer.getVirtualItems()
  const firstRendered = rows[0]?.index ?? 0
  const lastRendered = rows[rows.length - 1]?.index ?? 0
  const tabStop = roving.activeIndex >= firstRendered && roving.activeIndex <= lastRendered ? roving.activeIndex : firstRendered

  const renderRow = (index: number) => {
    const focus = { tabIndex: index === tabStop ? 0 : -1, [ROVING_INDEX_ATTR]: index }
    if (index === 0) {
      const selected = !selectedCategoryId
      return (
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selected}
          className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            selected ? 'bg-surface-800 text-surface-50 font-medium' : 'text-surface-400 hover:bg-surface-900 hover:text-surface-200'
          }`}
          {...focus}
        >
          <LayoutGrid size={16} className="mt-0.5 shrink-0" />
          <ClampText as="span" lines={2} titleText={allLabel} className="min-w-0 flex-1 text-left leading-5">
            {allLabel}
          </ClampText>
        </button>
      )
    }
    const category: CatalogCategory = categories[index - 1]
    const selected = category.id === selectedCategoryId
    return (
      <div
        className={`group flex items-start rounded-lg transition-colors ${
          selected ? 'border border-accent/45 bg-accent/15' : 'hover:bg-surface-900'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelect(category.id)}
          aria-pressed={selected}
          className={`flex min-w-0 flex-1 items-start gap-2 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            selected ? 'text-accent' : 'text-surface-400 group-hover:text-surface-200'
          }`}
          {...focus}
        >
          <Folder size={16} className="mt-0.5 shrink-0" />
          <ClampText as="span" lines={2} titleText={category.name} className="min-w-0 flex-1 text-left leading-5">
            {category.name}
          </ClampText>
        </button>
        <button
          type="button"
          onClick={() => toggleCategoryHidden(category.id)}
          tabIndex={index === tabStop ? 0 : -1}
          // Hidden until hover/focus so the sidebar stays calm, but reachable
          // by keyboard from the active row.
          className="mt-1.5 mr-2 shrink-0 rounded p-1 text-surface-500 opacity-0 transition-opacity hover:bg-surface-800 hover:text-surface-200 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100"
          aria-label={`${category.name} kategorisini gizle`}
          title="Bu kategoriyi gizle"
        >
          <EyeOff size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={setScrollElement} className="min-h-0 flex-1 overflow-y-auto p-3">
        <div
          ref={listRef}
          role="group"
          aria-label="Kategoriler"
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
              className="absolute left-0 top-0 w-full pb-1"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {renderRow(row.index)}
            </div>
          ))}
        </div>
        {loading && categories.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-surface-400">
            <Spinner size={14} />
            <span>Kategoriler yükleniyor...</span>
          </div>
        )}
        {error && (
          <div role="alert" className="mt-2 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-200">
            <p className="flex items-start gap-1.5 font-medium">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              Kategoriler yüklenemedi
            </p>
            <p className="mt-0.5 text-red-200/80">{error}</p>
            {onRetry && (
              <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>
                Tekrar Dene
              </Button>
            )}
          </div>
        )}
        {hiddenCount > 0 && (
          <p className="mt-2 px-3 text-xs leading-5 text-surface-500">
            {hiddenCount} kategori gizli. Ayarlar → Kategoriler bölümünden geri getirebilirsiniz.
          </p>
        )}
      </div>
    </div>
  )
})
