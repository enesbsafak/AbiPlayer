import { memo } from 'react'
import { Folder, LayoutGrid } from 'lucide-react'
import { useStore } from '@/store'
import type { Category } from '@/types/playlist'

export const CategoryList = memo(function CategoryList() {
  const { selectedCategoryId, setSelectedCategory, channelFilter, getCategoriesByType } = useStore()
  const categories = getCategoriesByType(channelFilter)

  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={() => setSelectedCategory(null)}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
          !selectedCategoryId ? 'bg-accent/10 text-accent' : 'text-surface-300 hover:bg-surface-800'
        }`}
      >
        <LayoutGrid size={16} />
        <span className="truncate">All Channels</span>
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => setSelectedCategory(cat.id)}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            cat.id === selectedCategoryId ? 'bg-accent/10 text-accent' : 'text-surface-300 hover:bg-surface-800'
          }`}
        >
          <Folder size={16} className="shrink-0" />
          <span className="truncate">{cat.name}</span>
        </button>
      ))}
    </div>
  )
})
