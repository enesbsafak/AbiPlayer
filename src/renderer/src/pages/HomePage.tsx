import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Tv, Film, Clapperboard, Star, Plus } from 'lucide-react'
import { useStore } from '@/store'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import { Button } from '@/components/ui/Button'
import type { Channel } from '@/types/playlist'

export default function HomePage() {
  const navigate = useNavigate()
  const { channels, sources, favoriteIds, playChannel, setMiniPlayer } = useStore()

  const handlePlay = useCallback((channel: Channel) => {
    playChannel(channel)
    setMiniPlayer(false)
    navigate('/player')
  }, [playChannel, setMiniPlayer, navigate])

  const recentLive = useMemo(() => channels.filter((c) => c.type === 'live').slice(0, 12), [channels])
  const recentVod = useMemo(() => channels.filter((c) => c.type === 'vod').slice(0, 6), [channels])
  const favChannels = useMemo(() => channels.filter((c) => favoriteIds.has(c.id)).slice(0, 6), [channels, favoriteIds])

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-accent/10">
            <Tv size={40} className="text-accent" />
          </div>
          <h1 className="text-3xl font-bold">Welcome to IPTV Player</h1>
          <p className="text-surface-400 max-w-md">
            Connect to an Xtream Codes server or import an M3U playlist to start watching.
          </p>
          <Button size="lg" onClick={() => navigate('/settings')}>
            <Plus size={20} /> Add Source
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 p-6">
      {favChannels.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Star size={20} className="text-yellow-400" /> Favorites
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/favorites')}>View All</Button>
          </div>
          <ChannelGrid channels={favChannels} onPlay={handlePlay} />
        </section>
      )}

      {recentLive.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Tv size={20} className="text-accent" /> Live TV
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/live')}>View All</Button>
          </div>
          <ChannelGrid channels={recentLive} onPlay={handlePlay} />
        </section>
      )}

      {recentVod.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Film size={20} className="text-emerald-400" /> Movies
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/vod')}>View All</Button>
          </div>
          <ChannelGrid channels={recentVod} onPlay={handlePlay} />
        </section>
      )}
    </div>
  )
}
