import { useNavigate } from 'react-router-dom'
import { Search, Plus } from 'lucide-react'
import { useStore } from '@/store'

export function Header() {
  const navigate = useNavigate()
  const activeSource = useStore((s) => s.sources.find((src) => src.id === s.activeSourceId))

  return (
    <header className="flex h-14 items-center justify-between border-b border-surface-800 bg-surface-950/80 backdrop-blur-sm px-6">
      <div className="flex items-center gap-4">
        {activeSource && (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-sm text-surface-300">{activeSource.name}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/search')}
          className="flex items-center gap-2 rounded-lg bg-surface-800 px-3 py-1.5 text-sm text-surface-400 hover:bg-surface-700 hover:text-white transition-colors"
        >
          <Search size={16} />
          <span className="hidden sm:block">Search</span>
          <kbd className="hidden sm:block rounded bg-surface-700 px-1.5 py-0.5 text-[10px] text-surface-500">⌘K</kbd>
        </button>
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600 transition-colors"
        >
          <Plus size={16} />
          <span className="hidden sm:block">Add Source</span>
        </button>
      </div>
    </header>
  )
}
