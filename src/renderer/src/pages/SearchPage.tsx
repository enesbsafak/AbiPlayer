import { useState, useCallback, useDeferredValue, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SearchIcon } from '@/components/ui/icons'
import { GroupedResults } from '@/components/catalog/GroupedResults'
import { Spinner } from '@/components/ui/Spinner'
import type { Channel } from '@/types/playlist'
import { useCatalogSearchResults } from '@/catalog'
import { useOpenCatalogItem } from '@/hooks/useOpenCatalogItem'
import { strings } from '@/strings'

const text = strings.catalog.search

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
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex h-[60px] w-full max-w-[760px] items-center gap-3 rounded-full bg-raised px-6 text-white focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-[3px] focus-within:outline-sun">
          <SearchIcon size={24} className="shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Arriving here (Ctrl+K, the bars' search) means typing next.
            autoFocus
            aria-label={text.label}
            placeholder={text.placeholder}
            className="h-full min-w-0 flex-1 bg-transparent text-lg text-white outline-none placeholder:text-surface-500 focus-visible:outline-none"
          />
        </div>
        {active && (
          <p className="flex items-center gap-2 px-2 text-[15px] text-surface-400" aria-live="polite">
            {text.found(deferredQuery, total)}
            {total > results.length && text.capped(results.length)}
            {isPending && <Spinner size={14} />}
          </p>
        )}
      </div>

      <div ref={setScrollElement} className="-mx-1.5 min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 pt-1.5">
        {active ? (
          results.length > 0 ? (
            <div role="region" aria-label={text.results}>
              <GroupedResults items={results} onOpen={handlePlay} scrollElement={scrollElement} idPrefix="search" />
            </div>
          ) : (
            !isPending && (
              <div className="flex flex-col items-center gap-2 rounded-tile bg-raised px-8 py-14 text-center">
                <p className="font-title text-[28px]">{strings.catalog.cards.noContent}</p>
                <p className="text-base text-surface-400">{text.idleHint(MIN_QUERY_LENGTH)}</p>
              </div>
            )
          )
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-tile bg-raised px-8 py-14 text-center">
            <span className="flex size-20 items-center justify-center rounded-full bg-white text-ink">
              <SearchIcon size={36} />
            </span>
            <p className="font-title text-[30px] leading-[1.05]">{text.idleTitle}</p>
            <p className="text-base text-surface-400">{text.idleHint(MIN_QUERY_LENGTH)}</p>
          </div>
        )}
      </div>
    </div>
  )
}
