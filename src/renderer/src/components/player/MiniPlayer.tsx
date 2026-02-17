import { useNavigate } from 'react-router-dom'
import { X, Maximize2 } from 'lucide-react'
import { useStore } from '@/store'

export function MiniPlayer() {
  const navigate = useNavigate()
  const { currentChannel, stopPlayback, setMiniPlayer } = useStore()

  if (!currentChannel) return null

  const handleExpand = () => {
    setMiniPlayer(false)
    navigate('/player')
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-surface-700 bg-surface-900 p-3 shadow-2xl">
      <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
      <span className="text-sm font-medium max-w-[200px] truncate">{currentChannel.name}</span>
      <div className="flex items-center gap-1">
        <button onClick={handleExpand} className="rounded-lg p-1.5 hover:bg-surface-700 transition-colors">
          <Maximize2 size={14} className="text-surface-400" />
        </button>
        <button onClick={stopPlayback} className="rounded-lg p-1.5 hover:bg-surface-700 transition-colors">
          <X size={14} className="text-surface-400" />
        </button>
      </div>
    </div>
  )
}
