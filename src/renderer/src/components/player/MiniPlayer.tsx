import { useNavigate } from 'react-router-dom'
import { X, Pause, Play } from 'lucide-react'
import { useStore } from '@/store'

/**
 * Leaving /player suspends playback (mpv is stopped, the <video> unmounted), so
 * this card must not look like something is playing. "Devam et" goes back to
 * the player: a film or episode resumes from its saved position, live restarts.
 */
export function MiniPlayer() {
  const navigate = useNavigate()
  const currentChannel = useStore((s) => s.currentChannel)
  const clearPlayerReturnTarget = useStore((s) => s.clearPlayerReturnTarget)
  const stopPlayback = useStore((s) => s.stopPlayback)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)

  if (!currentChannel) return null

  const isLive = currentChannel.type === 'live'

  const handleResume = () => {
    setMiniPlayer(false)
    navigate('/player')
  }

  return (
    <section className="fixed bottom-4 right-4 z-overlay flex items-center gap-3 rounded-lg border border-surface-800 bg-surface-900 p-3 shadow-lg" aria-label="Mini oynatıcı">
      <Pause size={14} className="shrink-0 text-surface-500" aria-hidden="true" />
      <div className="min-w-0">
        <p className="max-w-[200px] truncate text-sm font-medium text-surface-200">{currentChannel.name}</p>
        <p className="text-xs text-surface-500">Duraklatıldı</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleResume}
          className="flex items-center gap-1.5 rounded-md bg-accent/15 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
          aria-label={isLive ? 'Yayına geri dön' : 'Kaldığın yerden devam et'}
        >
          <Play size={12} aria-hidden="true" />
          Devam et
        </button>
        <button
          type="button"
          onClick={() => {
            setMiniPlayer(false)
            stopPlayback()
            clearPlayerReturnTarget()
          }}
          className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200"
          aria-label="Oynatmayı kapat"
        >
          <X size={14} />
        </button>
      </div>
    </section>
  )
}
