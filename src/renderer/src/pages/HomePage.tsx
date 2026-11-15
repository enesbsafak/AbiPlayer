import { useCallback, useMemo } from 'react'
import { Tv, Film, Clapperboard, Star } from 'lucide-react'
import { useStore } from '@/store'
import { HomeHero } from '@/components/home/HomeHero'
import { HomeSection } from '@/components/home/HomeSection'
import { ContinueWatchingSection } from '@/components/home/ContinueWatchingSection'
import { HomeError, HomeLoading, HomeNotice, HomeWelcome } from '@/components/home/HomeStates'
import { useHomeBootstrap } from '@/hooks/useHomeBootstrap'
import { useOpenCatalogItem, useOpenPlayback } from '@/hooks/useOpenCatalogItem'
import { useDeferredPlayback } from '@/hooks/useDeferredPlayback'
import type { Channel } from '@/types/playlist'
import { buildHomeCatalog, HOME_MAX_OTHER } from '@/components/home/home-catalog'
import { useFavoriteChannels, useOpenFavorite } from '@/components/favorites/favorite-channels'
import { catalog, useCatalogVersion, useVisibleCatalogItems } from '@/catalog'
import type { CatalogStatusMap } from '@/store/playlist-slice'
import { findM3uEntry } from '@/services/playback'
import {
  indexChannelsByLegacyKey,
  legacyIndexKey,
  selectContinueWatching,
  type ContinueWatchingItem
} from '@/services/watch-progress'
import { perfMark, usePerfMarkOnce } from '@/services/perf'
import { strings } from '@/strings'
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
  const activeSourceRetryAt = useStore((s) => (activeSourceId ? (s.sourceErrors[activeSourceId]?.retryAt ?? null) : null))
  const watchProgress = useStore((s) => s.watchProgress)
  const removeWatchProgress = useStore((s) => s.removeWatchProgress)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)

  const bootstrap = useHomeBootstrap()

  const handlePlay = useOpenCatalogItem()
  const openPlayback = useOpenPlayback()
  const deferred = useDeferredPlayback()
  const { playWhenReady } = deferred
  // History keeps no M3U entry URL: it is looked up in the loaded playlist,
  // waiting for the playlist when the card is clicked before it is in.
  const handleContinue = useCallback(
    (item: ContinueWatchingItem) => {
      const { target, channel } = item
      if (target.kind !== 'm3u') {
        openPlayback({ target, channel })
        return
      }
      playWhenReady(
        {
          sourceId: target.sourceId,
          name: channel.name,
          resolve: () => {
            const entry = findM3uEntry(target, catalog, channel.id)
            return entry ? { ...channel, streamUrl: entry.streamUrl } : null
          }
        },
        (resolved) => openPlayback({ target, channel: resolved })
      )
    },
    [openPlayback, playWhenReady]
  )
  const handleFavorite = useOpenFavorite(handlePlay, playWhenReady)

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
  // Nothing stored holds a URL. Xtream items are rebuilt from the live source
  // when played, so they are listed only while it has credentials; M3U items
  // are listed while their source exists and find their URL in its playlist.
  //
  // Entries from before the media-key migration that it could not map are
  // matched against the catalog by their old key; the index is built only for
  // sources that still have such entries.
  const sourcesWithCredentials = useMemo(
    () => new Set(sources.filter((source) => getXtreamCredentials(source.id)).map((source) => source.id)),
    [sources, getXtreamCredentials]
  )
  const sourceIds = useMemo(() => new Set(sources.map((source) => source.id)), [sources])
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
        hasSource: (sourceId) => sourceIds.has(sourceId),
        findLegacyChannel: (entry) => legacyIndex.get(legacyIndexKey(entry)) ?? null,
        limit: HOME_MAX_OTHER
      }),
    [watchProgress, sourcesWithCredentials, sourceIds, legacyIndex]
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
    return (
      <HomeError
        message={blockingError}
        onRetry={bootstrap.retry}
        detail={activeSourceRetryAt !== null ? strings.catalog.home.autoRetry : undefined}
      />
    )
  }

  const loading = new Set(bootstrap.loadingTypes)

  return (
    <div className="flex flex-col gap-8 p-4">
      <HomeHero channelCount={visibleCount} syncProgress={syncProgress} />

      {bootstrap.partialError && <HomeNotice message={bootstrap.partialError} onRetry={bootstrap.retry} />}
      {deferred.notice && (
        <HomeNotice
          message={deferred.notice.message}
          tone={deferred.notice.pending ? 'info' : 'error'}
          onDismiss={deferred.dismissNotice}
        />
      )}

      <ContinueWatchingSection
        entries={continueWatching}
        onPlay={handleContinue}
        onRemove={removeWatchProgress}
      />

      <HomeSection
        title={strings.catalog.favorites.title}
        icon={Star}
        viewAllTo="/favorites"
        channels={favChannels}
        onPlay={handleFavorite}
      />
      <HomeSection
        title={strings.catalog.types.live.section}
        icon={Tv}
        viewAllTo="/live"
        channels={recentLive}
        loading={loading.has('live')}
        onPlay={handlePlay}
      />
      <HomeSection
        title={strings.catalog.types.vod.section}
        icon={Film}
        iconClassName="text-signal"
        viewAllTo="/vod"
        channels={recentVod}
        loading={loading.has('vod')}
        onPlay={handlePlay}
      />
      <HomeSection
        title={strings.catalog.types.series.section}
        icon={Clapperboard}
        iconClassName="text-signal"
        viewAllTo="/series"
        channels={recentSeries}
        loading={loading.has('series')}
        onPlay={handlePlay}
      />
    </div>
  )
}
