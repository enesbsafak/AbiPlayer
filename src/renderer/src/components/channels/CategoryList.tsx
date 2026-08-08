import { memo, useMemo } from 'react'
import { EyeOff, Folder, LayoutGrid } from 'lucide-react'
import { useStore } from '@/store'
import { ClampText } from '@/components/ui'
import { applyCategoryView } from '@/services/catalog-view'

type CategoryFilter = 'live' | 'vod' | 'series'

interface CategoryListProps {
  filter: CategoryFilter
}

export const CategoryList = memo(function CategoryList({ filter }: CategoryListProps) {
  const selectedCategoryId = useStore((s) => s.selectedCategoryId)
  const setSelectedCategory = useStore((s) => s.setSelectedCategory)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const allCategories = useStore((s) => s.categories)
  const hiddenCategoryIds = useStore((s) => s.hiddenCategoryIds)
  const sortMode = useStore((s) => s.settings.catalogSortMode)
  const toggleCategoryHidden = useStore((s) => s.toggleCategoryHidden)
  const categories = useMemo(
    () =>
      applyCategoryView(
        allCategories.filter(
          (category) => category.type === filter && (!activeSourceId || category.sourceId === activeSourceId)
        ),
        { hiddenCategoryIds, sortMode }
      ),
    [allCategories, filter, activeSourceId, hiddenCategoryIds, sortMode]
  )
  const hiddenCount = useMemo(
    () =>
      allCategories.filter(
        (category) =>
          category.type === filter &&
          (!activeSourceId || category.sourceId === activeSourceId) &&
          hiddenCategoryIds.has(category.id)
      ).length,
    [allCategories, filter, activeSourceId, hiddenCategoryIds]
  )
  const allLabel = filter === 'vod' ? 'Tüm Filmler' : filter === 'series' ? 'Tüm Diziler' : 'Tüm Kanallar'

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setSelectedCategory(null)}
        className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
          !selectedCategoryId
            ? 'bg-surface-800 text-surface-50 font-medium'
            : 'text-surface-400 hover:bg-surface-900 hover:text-surface-200'
        }`}
      >
        <LayoutGrid size={16} className="mt-0.5 shrink-0" />
        <ClampText as="span" lines={2} titleText={allLabel} className="min-w-0 flex-1 text-left leading-5">
          {allLabel}
        </ClampText>
      </button>
      {categories.map((cat) => (
        <div
          key={cat.id}
          className={`group flex items-start rounded-lg transition-colors ${
            cat.id === selectedCategoryId
              ? 'border border-accent/45 bg-accent/15'
              : 'hover:bg-surface-900'
          }`}
        >
          <button
            type="button"
            onClick={() => setSelectedCategory(cat.id)}
            className={`flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-sm transition-colors ${
              cat.id === selectedCategoryId ? 'text-accent' : 'text-surface-400 group-hover:text-surface-200'
            }`}
          >
            <Folder size={16} className="mt-0.5 shrink-0" />
            <ClampText as="span" lines={2} titleText={cat.name} className="min-w-0 flex-1 text-left leading-5">
              {cat.name}
            </ClampText>
          </button>
          <button
            type="button"
            onClick={() => toggleCategoryHidden(cat.id)}
            // Hidden until hover/focus so the sidebar stays calm, but always
            // reachable by keyboard.
            className="mt-1.5 mr-2 shrink-0 rounded p-1 text-surface-500 opacity-0 transition-opacity hover:bg-surface-800 hover:text-surface-200 focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={`${cat.name} kategorisini gizle`}
            title="Bu kategoriyi gizle"
          >
            <EyeOff size={14} />
          </button>
        </div>
      ))}
      {hiddenCount > 0 && (
        <p className="mt-2 px-3 text-xs leading-5 text-surface-500">
          {hiddenCount} kategori gizli. Ayarlar → Kategoriler bölümünden geri getirebilirsiniz.
        </p>
      )}
    </div>
  )
})
