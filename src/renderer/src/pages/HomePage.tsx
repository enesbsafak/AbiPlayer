import { useCallback, useMemo } from 'react'
import { Tv, Film, Clapperboard, Star } from 'lucide-react'
import { useStore } from '@/store'
import { HomeHero } from '@/components/home/HomeHero'
import { HomeSection } from '@/components/home/HomeSection'
import { ContinueWatchingSection } from '@/components/home/ContinueWatchingSection'
import { HomeError, HomeLoading, HomeWelcome } from '@/components/home/HomeStates'
import { useHomeBootstrap } from '@/hooks/useHomeBootstrap'
import { useOpenCatalogItem, useOpenPlayback } from '@/hooks/useOpenCatalogItem'
import type { Channel } from '@/types/playlist'
import { buildHomeCatalog, HOME_MAX_OTHER } from '@/components/home/home-catalog'
import { useFavoriteChannels } from '@/components/favorites/favorite-channels'
import { catalog, useCatalogVersion, useVisibleCatalogItems } from '@/catalog'
import type { CatalogStatusMap } from '@/store/playlist-slice'
import {
  indexChannelsByLegacyKey,
  legacyIndexKey,
  selectContinueWatching,
  type ContinueWatchingItem
} from '@/services/watch-progress'
import { perfMark, usePerfMarkOnce } from '@/services/perf'
perfMark('renderer:home-chunk-loaded')

/** Items the source holds in every type, before any view rule. */
function sourceItemCount(status: CatalogStatusMap, sourceId: string | null): number {
  if (!sourceId) return 0
  const types = status[sourceId]
  return (types?.live?.count ?? 0) + (types?.vod?.count ?? 0) + (types?.series?.count ?? 0)
}

export default function HomePage() {
  const sources = useStore((s) => s.sources)
  const isLoading = useStore((s) => s.isLoading)
  const isLoadingPlaylist = useStore((s) => s.isLoadingPlaylist)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const syncProgress = useStore((s) => (activeSourceId ? s.syncProgress[activeSourceId] : undefined))
  const authError = useStore((s) => s.error)
  const watchProgress = useStore((s) => s.watchProgress)
  const removeWatchProgress = useStore((s) => s.removeWatchProgress)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)

  const bootstrap = useHomeBootstrap()

  const handlePlay = useOpenCatalogItem()
  const openPlayback = useOpenPlayback()
  const handleContinue = useCallback(
    (item: ContinueWatchingItem) => openPlayback({ target: item.target, channel: item.channel }),
    [openPlayback]
  )

  const visibleLive = useVisibleCatalogItems(activeSourceId, 'live')
  const visibleVod = useVisibleCatalogItems(activeSourceId, 'vod')
  const visibleSeries = useVisibleCatalogItems(activeSourceId, 'series')
  const totalCount = useStore((s) => sourceItemCount(s.catalogStatus, activeSourceId))

  const { visibleCount, hasSourceContent, recentLive, recentVod, recentSeries } = useMemo(
    () => buildHomeCatalog({ live: visibleLive, vod: visibleVod, series: visibleSeries, totalCount }),
    [visibleLive, visibleVod, visibleSeries, totalCount]
  )
  usePerfMarkOnce('renderer:home-first-content', hasSourceContent)

  // Favourites are an explicit user pick rather than a catalog listing, so
  // category hiding deliberately does not apply to them. Like the Favoriler
  // page this row opens, it spans every source.
  const favChannels = useFavoriteChannels(HOME_MAX_OTHER)

  // Like favourites, this is the viewer's own history rather than a catalog
  // listing, so category hiding deliberately does not filter it.
  //
  // Nothing stored holds an Xtream credential: those items are rebuilt from
  // the live source when played, so they are listed only while it has
  // credentials. M3U items carry their own URL.
  //
  // Entries from before the media-key migration that it could not map are
  // matched against the catalog by their old key; the index is built only for
  // sources that still have such entries.
  const sourcesWithCredentials = useMemo(
    () => new Set(sources.filter((source) => getXtreamCredentials(source.id)).map((source) => source.id)),
    [sources, getXtreamCredentials]
  )
  const legacySourceIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of watchProgress) if (!entry.target) ids.add(entry.channel.sourceId)
    return ids
  }, [watchProgress])
  const catalogVersion = useCatalogVersion()
  const legacyIndex = useMemo(() => {
    void catalogVersion
    if (legacySourceIds.size === 0) return new Map<string, Channel>()
    let candidates: Channel[] = []
    // Live entries never had a legacy key worth matching.
    for (const sourceId of legacySourceIds) {
      candidates = candidates.concat(catalog.getItems(sourceId, 'vod'), catalog.getItems(sourceId, 'series'))
    }
    return indexChannelsByLegacyKey(candidates, legacySourceIds)
  }, [catalogVersion, legacySourceIds])
  const continueWatching = useMemo(
    () =>
      selectContinueWatching(watchProgress, {
        hasCredentials: (sourceId) => sourcesWithCredentials.has(sourceId),
        findLegacyChannel: (entry) => legacyIndex.get(legacyIndexKey(entry)) ?? null,
        limit: HOME_MAX_OTHER
      }),
    [watchProgress, sourcesWithCredentials, legacyIndex]
  )

  if (sources.length === 0) return <HomeWelcome />

  const hasNoContent = !hasSourceContent
  const showInitialLoading =
    hasNoContent && (isLoading || isLoadingPlaylist || bootstrap.isBootstrapping)

  if (showInitialLoading) {
    return (
      <HomeLoading
        isConnectingSources={isLoading && !isLoadingPlaylist}
        stage={bootstrap.stage}
        onRetry={bootstrap.retry}
      />
    )
  }

  // `bootstrap.error` only covers the catalog fetch; connection failures live in
  // the auth slice and used to be surfaced nowhere, so a wrong password or dead
  // server just showed an empty dashboard.
  const blockingError = bootstrap.error ?? authError
  if (blockingError && hasNoContent) {
    return <HomeError message={blockingError} onRetry={bootstrap.retry} />
  }

  return (
    <div className="flex flex-col gap-8 p-4">
      <HomeHero channelCount={visibleCount} syncProgress={syncProgress} />

      <ContinueWatchingSection
        entries={continueWatching}
        onPlay={handleContinue}
        onRemove={removeWatchProgress}
      />

      <HomeSection
        title="Favoriler"
        icon={Star}
        viewAllTo="/favorites"
        channels={favChannels}
        onPlay={handlePlay}
      />
      <HomeSection
        title="Canlı TV"
        icon={Tv}
        viewAllTo="/live"
        channels={recentLive}
        onPlay={handlePlay}
      />
      <HomeSection
        title="Filmler"
        icon={Film}
        iconClassName="text-signal"
        viewAllTo="/vod"
        channels={recentVod}
        onPlay={handlePlay}
      />
      <HomeSection
        title="Diziler"
        icon={Clapperboard}
        iconClassName="text-signal"
        viewAllTo="/series"
        channels={recentSeries}
        onPlay={handlePlay}
      />
    </div>
  )
}
