import { memo, useMemo } from 'react'
import { Folder, LayoutGrid } from 'lucide-react'
import { useStore } from '@/store'

export const CategoryList = memo(function CategoryList() {
  const selectedCategoryId = useStore((s) => s.selectedCategoryId)
  const setSelectedCategory = useStore((s) => s.setSelectedCategory)
  const channelFilter = useStore((s) => s.channelFilter)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const allCategories = useStore((s) => s.categories)
  const categories = useMemo(
    () =>
      allCategories.filter(
        (category) => category.type === channelFilter && (!activeSourceId || category.sourceId === activeSourceId)
      ),
    [allCategories, channelFilter, activeSourceId]
  )
  const allLabel = channelFilter === 'vod' ? 'Tum Filmler' : channelFilter === 'series' ? 'Tum Diziler' : 'Tum Kanallar'

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => setSelectedCategory(null)}
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
          !selectedCategoryId
            ? 'border border-accent/45 bg-accent/15 text-accent'
            : 'border border-transparent text-surface-300 hover:border-surface-600/35 hover:bg-surface-800/60'
        }`}
      >
        <LayoutGrid size={16} />
        <span className="truncate">{allLabel}</span>
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => setSelectedCategory(cat.id)}
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
            cat.id === selectedCategoryId
              ? 'border border-accent/45 bg-accent/15 text-accent'
              : 'border border-transparent text-surface-300 hover:border-surface-600/35 hover:bg-surface-800/60'
          }`}
        >
          <Folder size={16} className="shrink-0" />
          <span className="truncate">{cat.name}</span>
        </button>
      ))}
    </div>
  )
})
