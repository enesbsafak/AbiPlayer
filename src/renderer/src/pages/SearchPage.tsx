import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useStore } from '@/store'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import type { Channel } from '@/types/playlist'
import { isPlayableChannel } from '@/services/playback'

export default function SearchPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const channels = useStore((s) => s.channels)
  const playChannel = useStore((s) => s.playChannel)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)

  const results = useMemo(() => {
    if (!query || query.length < 2) return []
    const q = query.toLowerCase()
    return channels.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.group?.toLowerCase().includes(q) ||
      c.categoryName?.toLowerCase().includes(q)
    ).slice(0, 100)
  }, [query, channels])

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
        <div className="relative mx-auto mb-8 max-w-xl">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tum kanal, film ve dizilerde ara..."
            autoFocus
            className="w-full rounded-xl border border-surface-600/35 bg-surface-900/70 py-3 pl-12 pr-4 text-lg text-surface-100 placeholder:text-surface-400 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/45"
          />
        </div>

        {query.length >= 2 && (
          <div>
            <p className="mb-4 text-sm text-surface-300">"{query}" icin {results.length} sonuc bulundu</p>
            <ChannelGrid channels={results} onPlay={handlePlay} />
          </div>
        )}

        {query.length < 2 && (
          <div className="py-20 text-center text-surface-400">
            <Search size={48} className="mx-auto mb-4" />
            <p className="text-lg">Tum kaynaklarda arama yapin</p>
            <p className="mt-1 text-sm">Baslamak icin en az 2 karakter yazin</p>
          </div>
        )}
      </div>
    </div>
  )
}
