import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { FavoritesView } from '@/components/favorites/FavoritesView'
import type { Channel } from '@/types/playlist'
import { isPlayableChannel } from '@/services/playback'
import { openPlayerFromRoute } from '@/services/player-navigation'

export default function FavoritesPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const playChannel = useStore((s) => s.playChannel)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const setPlayerReturnTarget = useStore((s) => s.setPlayerReturnTarget)

  const handlePlay = useCallback((channel: Channel) => {
    if (!isPlayableChannel(channel)) {
      if (channel.type === 'series') navigate('/series')
      return
    }

    playChannel(channel)
    setMiniPlayer(false)
    openPlayerFromRoute({ location, navigate, setPlayerReturnTarget })
  }, [location, playChannel, setMiniPlayer, navigate, setPlayerReturnTarget])

  return (
    <div className="h-full p-3">
      <div className="rounded-lg border border-surface-800 bg-surface-900 h-full overflow-y-auto p-5">
        <h1 className="text-lg font-semibold text-white">Favoriler</h1>
        <div className="mt-5">
          <FavoritesView onPlay={handlePlay} />
        </div>
      </div>
    </div>
  )
}
