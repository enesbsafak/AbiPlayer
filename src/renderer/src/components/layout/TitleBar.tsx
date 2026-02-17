import { Minus, X, Maximize2 } from 'lucide-react'
import { isElectron, windowMinimize, windowMaximize, windowClose } from '@/services/platform'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'

export function TitleBar() {
  if (!isElectron()) return null

  return (
    <div className="drag-region relative z-40 flex h-11 items-center justify-between border-b border-white/10 bg-[linear-gradient(180deg,rgba(30,26,60,0.82),rgba(16,12,38,0.72))] px-3 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),transparent_35%)]" />
      <div className="no-drag flex items-center gap-2.5">
        <span className="text-[13px] font-semibold text-white">{APP_NAME}</span>
        <span className="rounded-md border border-white/15 bg-white/8 px-1.5 py-0.5 text-[10px] font-medium text-surface-400">
          {APP_VERSION_LABEL}
        </span>
      </div>

      <div className="no-drag relative flex items-center gap-1.5 rounded-2xl border border-white/30 bg-black/25 p-1 shadow-[0_10px_24px_rgba(0,0,0,0.38)] backdrop-blur-xl">
        <button
          onClick={windowMinimize}
          title="Asagi Al"
          aria-label="Pencereyi asagi al"
          className="group relative flex h-7 w-7 items-center justify-center rounded-full border border-black/25 bg-[#f7c04a] shadow-[inset_0_1px_0_rgba(255,255,255,0.36)] transition-all hover:-translate-y-[1px] hover:brightness-110"
        >
          <Minus size={12} className="text-black/80" />
        </button>
        <button
          onClick={windowMaximize}
          title="Boyut Degistir"
          aria-label="Pencere boyutunu degistir"
          className="group relative flex h-7 w-7 items-center justify-center rounded-full border border-black/25 bg-[#35c768] shadow-[inset_0_1px_0_rgba(255,255,255,0.34)] transition-all hover:-translate-y-[1px] hover:brightness-110"
        >
          <Maximize2 size={11} className="text-black/80" />
        </button>
        <button
          onClick={windowClose}
          title="Kapat"
          aria-label="Pencereyi kapat"
          className="group relative flex h-7 w-7 items-center justify-center rounded-full border border-black/25 bg-[#ff5f57] shadow-[inset_0_1px_0_rgba(255,255,255,0.34)] transition-all hover:-translate-y-[1px] hover:brightness-110"
        >
          <X size={11} className="text-black/80" />
        </button>
      </div>
    </div>
  )
}
