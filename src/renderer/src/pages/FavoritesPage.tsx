import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { FavoritesView } from '@/components/favorites/FavoritesView'
import type { Channel } from '@/types/playlist'

export default function FavoritesPage() {
  const navigate = useNavigate()
  const { playChannel, setMiniPlayer } = useStore()

  const handlePlay = useCallback((channel: Channel) => {
    playChannel(channel)
    setMiniPlayer(false)
    navigate('/player')
  }, [playChannel, setMiniPlayer, navigate])

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-6">Favorites</h1>
      <FavoritesView onPlay={handlePlay} />
    </div>
  )
}
