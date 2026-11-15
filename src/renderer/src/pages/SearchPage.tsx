import { useState, useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import type { Channel } from '@/types/playlist'
import { useCatalogSearch } from '@/catalog'
import { useOpenCatalogItem } from '@/hooks/useOpenCatalogItem'

const MAX_RESULTS = 100

export default function SearchPage() {
  const routeLocation = useLocation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const openItem = useOpenCatalogItem()

  useEffect(() => {
    const state = routeLocation.state as { restoreSearchQuery?: string } | null
    if (typeof state?.restoreSearchQuery !== 'string') return

    setQuery(state.restoreSearchQuery)
    navigate(
      {
        pathname: routeLocation.pathname,
        search: routeLocation.search,
        hash: routeLocation.hash
      },
      { replace: true, state: null }
    )
  }, [routeLocation.hash, routeLocation.pathname, routeLocation.search, routeLocation.state, navigate])

  // Name and group, on the same view the lists show; clean matches before
  // adult ones, then capped.
  const results = useCatalogSearch(query.length >= 2 ? query : '', MAX_RESULTS)

  const handlePlay = useCallback(
    (channel: Channel) =>
      openItem(channel, {
        returnState: query.length >= 2 ? { restoreSearchQuery: query } : undefined,
        seriesRouteState: { restoreSearchQuery: query }
      }),
    [openItem, query]
  )

  return (
    <div className="h-full p-3">
      <div className="rounded-lg border border-surface-800 bg-surface-900 h-full overflow-y-auto p-5">
        <div className="relative mx-auto mb-8 max-w-xl">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Tüm içeriklerde ara"
            placeholder="Tüm kanal, film ve dizilerde ara..."
            className="w-full rounded-lg border border-surface-700 bg-surface-900 py-3 pl-12 pr-4 text-lg text-surface-50 placeholder:text-surface-500 transition-colors focus:border-surface-600 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {query.length >= 2 && (
          <div>
            <p className="mb-4 text-sm text-surface-300">"{query}" için {results.length} sonuç bulundu</p>
            <ChannelGrid channels={results} onPlay={handlePlay} />
          </div>
        )}

        {query.length < 2 && (
          <div className="py-20 text-center text-surface-400">
            <Search size={48} className="mx-auto mb-4" />
            <p className="text-lg">Tüm kaynaklarda arama yapın</p>
            <p className="mt-1 text-sm">Başlamak için en az 2 karakter yazın</p>
          </div>
        )}
      </div>
    </div>
  )
}
