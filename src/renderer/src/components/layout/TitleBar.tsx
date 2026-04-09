import { Minus, X, Maximize2 } from 'lucide-react'
import { isElectron, windowMinimize, windowMaximize, windowClose } from '@/services/platform'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'

export function TitleBar() {
  if (!isElectron()) return null

  return (
    <div className="drag-region relative z-titlebar flex h-11 items-center justify-between border-b border-surface-800 bg-surface-950 px-4">
      <div className="no-drag flex items-center gap-2.5">
        <span className="text-body-sm font-semibold text-surface-50">{APP_NAME}</span>
        <span className="rounded border border-surface-700 bg-surface-900 px-1.5 py-0.5 text-caption font-medium text-surface-500">
          {APP_VERSION_LABEL}
        </span>
      </div>

      <div className="no-drag flex items-center">
        <button
          onClick={windowMinimize}
          title="Asagi Al"
          aria-label="Pencereyi asagi al"
          className="flex h-8 w-10 items-center justify-center text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={windowMaximize}
          title="Boyut Degistir"
          aria-label="Pencere boyutunu degistir"
          className="flex h-8 w-10 items-center justify-center text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
        >
          <Maximize2 size={12} />
        </button>
        <button
          onClick={windowClose}
          title="Kapat"
          aria-label="Pencereyi kapat"
          className="flex h-8 w-10 items-center justify-center text-surface-400 transition-colors hover:bg-red-600 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
