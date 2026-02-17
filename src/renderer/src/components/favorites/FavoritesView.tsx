import { useMemo } from 'react'
import { Heart } from 'lucide-react'
import { useStore } from '@/store'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import type { Channel } from '@/types/playlist'

interface FavoritesViewProps {
  onPlay: (channel: Channel) => void
}

export function FavoritesView({ onPlay }: FavoritesViewProps) {
  const channels = useStore((s) => s.channels)
  const favoriteIds = useStore((s) => s.favoriteIds)
  const favorites = useMemo(
    () => channels.filter((c) => favoriteIds.has(c.id)),
    [channels, favoriteIds]
  )

  if (favorites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-surface-400">
        <Heart size={48} className="mb-4" />
        <p className="text-lg">Henuz favori yok</p>
        <p className="text-sm mt-1">Favorilere eklemek icin kanallari yildizlayin</p>
      </div>
    )
  }

  return <ChannelGrid channels={favorites} onPlay={onPlay} />
}
