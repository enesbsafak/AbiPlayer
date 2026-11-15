import { useState, useCallback, useDeferredValue, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import { Spinner } from '@/components/ui/Spinner'
import type { Channel } from '@/types/playlist'
import { useCatalogSearchResults } from '@/catalog'
import { useOpenCatalogItem } from '@/hooks/useOpenCatalogItem'

/** Results drawn at most; the count above them is every match. */
const MAX_RESULTS = 300
const MIN_QUERY_LENGTH = 2

export default function SearchPage() {
  const routeLocation = useLocation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const openItem = useOpenCatalogItem()

  useEffect(() => {
    const state = routeLocation.state as { restoreSearchQuery?: string } | null
    if (typeof state?.restoreSearchQuery !== 'string') return

    setQuery(state.restoreSearchQuery)
    void navigate(
      {
        pathname: routeLocation.pathname,
        search: routeLocation.search,
        hash: routeLocation.hash
      },
      { replace: true, state: null }
    )
  }, [routeLocation.hash, routeLocation.pathname, routeLocation.search, routeLocation.state, navigate])

  // The box follows every keystroke; the scan over every source follows as a
  // deferred render the next keystroke can interrupt.
  const deferredQuery = useDeferredValue(query)
  const active = deferredQuery.trim().length >= MIN_QUERY_LENGTH
  // Name and group, on the same view the lists show; clean matches before
  // adult ones, then capped. `total` is every match.
  const { items: results, total } = useCatalogSearchResults(active ? deferredQuery : '', MAX_RESULTS)
  const isPending = query !== deferredQuery

  const handlePlay = useCallback(
    (channel: Channel) =>
      openItem(channel, {
        returnState: query.length >= MIN_QUERY_LENGTH ? { restoreSearchQuery: query } : undefined,
        seriesRouteState: { restoreSearchQuery: query }
      }),
    [openItem, query]
  )

  return (
    <div className="h-full p-3">
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-surface-800 bg-surface-900">
        <div className="shrink-0 px-5 pt-5">
          <div className="relative mx-auto mb-6 max-w-xl">
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
          {active && (
            <p className="mb-4 flex items-center gap-2 text-sm text-surface-300" aria-live="polite">
              "{deferredQuery}" için {total.toLocaleString('tr-TR')} sonuç bulundu
              {total > results.length && ` (ilk ${results.length.toLocaleString('tr-TR')} gösteriliyor)`}
              {isPending && <Spinner size={14} />}
            </p>
          )}
        </div>

        <div ref={setScrollElement} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {active ? (
            <ChannelGrid channels={results} onPlay={handlePlay} scrollElement={scrollElement} ariaLabel="Arama sonuçları" />
          ) : (
            <div className="py-20 text-center text-surface-400">
              <Search size={48} className="mx-auto mb-4" />
              <p className="text-lg">Tüm kaynaklarda arama yapın</p>
              <p className="mt-1 text-sm">Başlamak için en az 2 karakter yazın</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
