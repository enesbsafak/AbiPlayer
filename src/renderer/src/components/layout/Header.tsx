import { useNavigate } from 'react-router-dom'
import { Search, Plus } from 'lucide-react'
import { useStore } from '@/store'
import { APP_VERSION_LABEL } from '@/constants/app-info'

export function Header() {
  const navigate = useNavigate()
  const activeSource = useStore((s) => s.sources.find((src) => src.id === s.activeSourceId))

  return (
    <header className="mx-3 mt-3 flex h-16 items-center justify-between rounded-3xl border border-white/20 bg-[linear-gradient(120deg,rgba(29,45,74,0.7),rgba(18,30,52,0.56))] px-5 shadow-[0_16px_34px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-4">
        <div className="hidden rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-100 lg:block">
          {APP_VERSION_LABEL}
        </div>
        {activeSource && (
          <div className="flex min-w-0 items-center gap-2 rounded-full border border-[#57d7c4]/35 bg-[#57d7c4]/14 px-3 py-1 text-xs uppercase tracking-[0.14em] text-surface-100">
            <div className="h-2 w-2 rounded-full bg-[#57d7c4] shadow-[0_0_0_4px_rgba(87,215,196,0.26)]" />
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
          className="flex items-center gap-2 rounded-xl border border-[#8ab8ff]/80 bg-[linear-gradient(160deg,#78acff,#5d8ff0)] px-3 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(79,132,236,0.4)] transition-all hover:brightness-110"
        >
          <Plus size={16} />
          <span className="hidden sm:block">Kaynak Ekle</span>
        </button>
      </div>
    </header>
  )
}
