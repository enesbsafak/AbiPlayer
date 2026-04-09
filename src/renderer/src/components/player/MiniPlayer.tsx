import { useNavigate } from 'react-router-dom'
import { X, Maximize2 } from 'lucide-react'
import { useStore } from '@/store'

export function MiniPlayer() {
  const navigate = useNavigate()
  const { clearPlayerReturnTarget, currentChannel, stopPlayback, setMiniPlayer } = useStore()

  if (!currentChannel) return null

  const handleExpand = () => {
    setMiniPlayer(false)
    navigate('/player')
  }

  return (
    <div className="fixed bottom-4 right-4 z-overlay flex items-center gap-3 rounded-lg border border-surface-800 bg-surface-900 p-3 shadow-lg" role="region" aria-label="Mini oynatıcı">
      <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
      <span className="text-sm font-medium text-surface-200 max-w-[200px] truncate">{currentChannel.name}</span>
      <div className="flex items-center gap-1">
        <button onClick={handleExpand} className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200" aria-label="Oynatıcıyı büyüt">
          <Maximize2 size={14} />
        </button>
        <button
          onClick={() => {
            setMiniPlayer(false)
            stopPlayback()
            clearPlayerReturnTarget()
          }}
          className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200"
          aria-label="Oynatmayı durdur"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
