import { useNavigate } from 'react-router-dom'
import { Search, Plus } from 'lucide-react'
import { useStore } from '@/store'
import { APP_VERSION_LABEL } from '@/constants/app-info'

export function Header() {
  const navigate = useNavigate()
  const activeSource = useStore((s) => s.sources.find((src) => src.id === s.activeSourceId))

  return (
    <header className="flex h-14 items-center justify-between border-b border-surface-800 bg-surface-950 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden rounded border border-surface-700 bg-surface-900 px-2 py-0.5 text-label font-medium text-surface-500 lg:block">
          {APP_VERSION_LABEL}
        </span>
        {activeSource && (
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-signal-600/30 bg-signal/5 px-2.5 py-1 text-xs font-medium text-surface-300">
            <div className="h-1.5 w-1.5 rounded-full bg-signal" />
            <span className="max-w-[260px] truncate">{activeSource.name}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/search')}
          className="flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900 px-3 py-1.5 text-sm text-surface-400 transition-colors hover:border-surface-600 hover:text-surface-200"
        >
          <Search size={14} />
          <span className="hidden sm:block">Ara</span>
          <kbd className="hidden rounded border border-surface-700 bg-surface-800 px-1.5 py-0.5 text-caption text-surface-500 sm:block">Ctrl+K</kbd>
        </button>

        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-600"
        >
          <Plus size={14} />
          <span className="hidden sm:block">Kaynak Ekle</span>
        </button>
      </div>
    </header>
  )
}
