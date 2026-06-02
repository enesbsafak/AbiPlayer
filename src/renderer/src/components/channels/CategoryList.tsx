import { memo, useMemo } from 'react'
import { Folder, LayoutGrid } from 'lucide-react'
import { useStore } from '@/store'
import { ClampText } from '@/components/ui'

type CategoryFilter = 'live' | 'vod' | 'series'

interface CategoryListProps {
  filter: CategoryFilter
}

export const CategoryList = memo(function CategoryList({ filter }: CategoryListProps) {
  const selectedCategoryId = useStore((s) => s.selectedCategoryId)
  const setSelectedCategory = useStore((s) => s.setSelectedCategory)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const allCategories = useStore((s) => s.categories)
  const categories = useMemo(
    () =>
      allCategories.filter(
        (category) => category.type === filter && (!activeSourceId || category.sourceId === activeSourceId)
      ),
    [allCategories, filter, activeSourceId]
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
        <button
          key={cat.id}
          type="button"
          onClick={() => setSelectedCategory(cat.id)}
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            cat.id === selectedCategoryId
              ? 'border border-accent/45 bg-accent/15 text-accent'
              : 'text-surface-400 hover:bg-surface-900 hover:text-surface-200'
          }`}
        >
          <Folder size={16} className="mt-0.5 shrink-0" />
          <ClampText as="span" lines={2} titleText={cat.name} className="min-w-0 flex-1 text-left leading-5">
            {cat.name}
          </ClampText>
        </button>
      ))}
    </div>
  )
})
