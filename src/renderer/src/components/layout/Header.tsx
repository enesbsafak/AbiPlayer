import { useNavigate } from 'react-router-dom'
import { Search, Plus } from 'lucide-react'
import { useStore } from '@/store'
import { APP_VERSION_LABEL } from '@/constants/app-info'

export function Header() {
  const navigate = useNavigate()
  const activeSource = useStore((s) => s.sources.find((src) => src.id === s.activeSourceId))

  return (
    <header className="mx-3 mt-3 flex h-16 items-center justify-between rounded-3xl border border-white/10 bg-[linear-gradient(120deg,rgba(26,22,52,0.72),rgba(14,12,34,0.6))] px-5 shadow-[0_16px_34px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-4">
        <div className="hidden rounded-md border border-white/12 bg-white/6 px-2.5 py-1 text-[11px] font-medium text-surface-400 lg:block">
          {APP_VERSION_LABEL}
        </div>
        {activeSource && (
          <div className="flex min-w-0 items-center gap-2 rounded-full border border-[#2dd4bf]/30 bg-[#2dd4bf]/10 px-3 py-1 text-xs font-medium text-surface-200">
            <div className="h-2 w-2 rounded-full bg-[#2dd4bf] shadow-[0_0_0_4px_rgba(45,212,191,0.22)]" />
            <span className="max-w-[260px] truncate">{activeSource.name}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/search')}
          className="flex items-center gap-2 rounded-xl border border-white/22 bg-white/10 px-3 py-2 text-sm text-surface-100 transition-colors hover:border-white/35 hover:bg-white/18 hover:text-white"
        >
          <Search size={16} />
          <span className="hidden sm:block">Ara</span>
          <kbd className="hidden rounded border border-white/30 bg-black/20 px-1.5 py-0.5 text-[10px] text-surface-200 sm:block">Ctrl+K</kbd>
        </button>

        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-2 rounded-xl border border-[#9d84f8]/70 bg-[linear-gradient(160deg,#8b74f9,#6a50ef)] px-3 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(124,106,247,0.4)] transition-all hover:brightness-110"
        >
          <Plus size={16} />
          <span className="hidden sm:block">Kaynak Ekle</span>
        </button>
      </div>
    </header>
  )
}
