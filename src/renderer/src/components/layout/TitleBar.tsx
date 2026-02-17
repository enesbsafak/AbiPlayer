import { Minus, Square, X, Maximize2 } from 'lucide-react'
import { isElectron, windowMinimize, windowMaximize, windowClose } from '@/services/platform'

export function TitleBar() {
  if (!isElectron()) return null

  return (
    <div className="drag-region flex h-8 items-center justify-between bg-surface-950 px-2">
      <div className="flex items-center gap-2 no-drag">
        <span className="text-xs font-semibold text-accent">IPTV Player</span>
      </div>
      <div className="flex items-center no-drag">
        <button onClick={windowMinimize} className="flex h-8 w-10 items-center justify-center hover:bg-surface-800 transition-colors">
          <Minus size={14} className="text-surface-400" />
        </button>
        <button onClick={windowMaximize} className="flex h-8 w-10 items-center justify-center hover:bg-surface-800 transition-colors">
          <Maximize2 size={12} className="text-surface-400" />
        </button>
        <button onClick={windowClose} className="flex h-8 w-10 items-center justify-center hover:bg-red-600 transition-colors">
          <X size={14} className="text-surface-400" />
        </button>
      </div>
    </div>
  )
}
