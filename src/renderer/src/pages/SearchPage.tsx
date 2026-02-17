import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useStore } from '@/store'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import type { Channel } from '@/types/playlist'

export default function SearchPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const { channels, playChannel, setMiniPlayer } = useStore()

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
    playChannel(channel)
    setMiniPlayer(false)
    navigate('/player')
  }, [playChannel, setMiniPlayer, navigate])

  return (
    <div className="p-6">
      <div className="relative max-w-xl mx-auto mb-8">
        <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all channels, movies, series..."
          autoFocus
          className="w-full rounded-xl border border-surface-700 bg-surface-900 pl-12 pr-4 py-3 text-lg text-white placeholder:text-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
        />
      </div>

      {query.length >= 2 && (
        <div>
          <p className="text-sm text-surface-400 mb-4">{results.length} results for "{query}"</p>
          <ChannelGrid channels={results} onPlay={handlePlay} />
        </div>
      )}

      {query.length < 2 && (
        <div className="text-center py-20 text-surface-500">
          <Search size={48} className="mx-auto mb-4" />
          <p className="text-lg">Search across all your sources</p>
          <p className="text-sm mt-1">Type at least 2 characters to begin</p>
        </div>
      )}
    </div>
  )
}
