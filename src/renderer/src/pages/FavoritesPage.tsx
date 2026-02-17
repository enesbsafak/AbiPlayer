import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { FavoritesView } from '@/components/favorites/FavoritesView'
import type { Channel } from '@/types/playlist'
import { isPlayableChannel } from '@/services/playback'

export default function FavoritesPage() {
  const navigate = useNavigate()
  const playChannel = useStore((s) => s.playChannel)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)

  const handlePlay = useCallback((channel: Channel) => {
    if (!isPlayableChannel(channel)) {
      if (channel.type === 'series') navigate('/series')
      return
    }

    playChannel(channel)
    setMiniPlayer(false)
    navigate('/player')
  }, [playChannel, setMiniPlayer, navigate])

  return (
    <div className="h-full p-3">
      <div className="panel-glass h-full overflow-y-auto rounded-2xl p-5">
        <h1 className="font-display text-xl uppercase tracking-[0.08em] text-surface-100">Favoriler</h1>
        <div className="mt-5">
          <FavoritesView onPlay={handlePlay} />
        </div>
      </div>
    </div>
  )
}
