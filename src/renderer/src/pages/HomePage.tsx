import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { ContinueTile, IdleTile, NewestFilmTile } from '@/components/home/HomeFeature'
import { HomeStage, useMediaQuery, type HomeRow, type SourceTone } from '@/components/home/HomeRows'
import { HomeChannelPanel, type PanelChannel } from '@/components/home/HomeChannelPanel'
import { HomeTiles } from '@/components/home/HomeTiles'
import { HomeError, HomeLoading, HomeNotice, HomeWelcome } from '@/components/home/HomeStates'
import { useSpatialArrowKeys } from '@/components/home/spatial-focus'
import { useHomeBootstrap } from '@/hooks/useHomeBootstrap'
import { useOpenCatalogItem, useOpenPlayback } from '@/hooks/useOpenCatalogItem'
import { useDeferredPlayback } from '@/hooks/useDeferredPlayback'
import { formatClockTime, useMinuteClock } from '@/hooks/useMinuteClock'
import type { Channel } from '@/types/playlist'
import {
  buildHomeCatalog,
  countGuideChannels,
  describeTiles,
  HOME_MAX_FILMS,
  findGuideHighlights,
  type HomeSourceState
} from '@/components/home/home-catalog'
import { useFavoriteChannels, useOpenFavorite } from '@/components/favorites/favorite-channels'
import {
  catalog,
  useCatalogStatus,
  useCatalogVersion,
  useCatalogViewSettings,
  useVisibleCatalogCategories,
  useVisibleCatalogItems
} from '@/catalog'
import type { CatalogStatusMap } from '@/store/playlist-slice'
import { findM3uEntry } from '@/services/playback'
import { findCurrentProgram, channelPrograms } from '@/services/epg-service'
import {
  indexChannelsByLegacyKey,
  legacyIndexKey,
  selectContinueWatching,
  seriesRouteStateOf,
  type ContinueWatchingItem
} from '@/services/watch-progress'
import { perfMark, usePerfMarkOnce } from '@/services/perf'
import { strings } from '@/strings'
perfMark('renderer:home-chunk-loaded')

const text = strings.catalog.home
const TYPE_COUNT = 3
/** The continue tile shows the most recent item; the rest go to a row. */
const CONTINUE_LIMIT = 13
/** Channels offered to the channel panel (it shows as many as fit). */
const PANEL_CHANNELS = 60
/** Film categories offered as rows (as many as fit are drawn), and the fewest films such a row needs. */
const CATEGORY_ROWS = 8
const CATEGORY_ROW_MIN = 6
/** A favourites row with fewer would be mostly empty; the channel panel and Favoriler hold them. */
const FAVORITES_ROW_MIN = 4
/** From this width the tile block gains the channel panel (HomeStage). */
const PANEL_QUERY = '(min-width: 1600px)'
const INCLUDE_HIDDEN = { includeHidden: true } as const

/** Items the source holds in every type, before any view rule. */
function sourceItemCount(status: CatalogStatusMap, sourceId: string | null): number {
  if (!sourceId) return 0
  const types = status[sourceId]
  return (types?.live?.count ?? 0) + (types?.vod?.count ?? 0) + (types?.series?.count ?? 0)
}

/**
 * The home screen: a launcher. The large tile picks up where the viewer left
 * off (or shows what is new, or how the source is doing), four tiles open the
 * sections, and the newest films sit underneath. Everything on it is the
 * active source's real data; nothing is a placeholder statistic.
 */
export default function HomePage() {
  const sources = useStore((s) => s.sources)
  const isLoading = useStore((s) => s.isLoading)
  const isLoadingPlaylist = useStore((s) => s.isLoadingPlaylist)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const activeSource = useMemo(() => sources.find((source) => source.id === activeSourceId) ?? null, [sources, activeSourceId])
  const syncProgress = useStore((s) => (activeSourceId ? s.syncProgress[activeSourceId] : undefined))
  const authError = useStore((s) => s.error)
  const activeSourceFailed = useStore((s) => !!(activeSourceId && s.sourceErrors[activeSourceId]))
  const activeSourceRetryAt = useStore((s) => (activeSourceId ? (s.sourceErrors[activeSourceId]?.retryAt ?? null) : null))
  const watchProgress = useStore((s) => s.watchProgress)
  const removeWatchProgress = useStore((s) => s.removeWatchProgress)
  const setSelectedCategory = useStore((s) => s.setSelectedCategory)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const epgData = useStore((s) => (activeSourceId && s.epgSourceId === activeSourceId ? s.epgData : null))

  const bootstrap = useHomeBootstrap()
  const now = useMinuteClock()
  const onArrowKey = useSpatialArrowKeys()

  const handlePlay = useOpenCatalogItem()
  const navigate = useNavigate()
  const openPlayback = useOpenPlayback()
  const deferred = useDeferredPlayback()
  const { playWhenReady } = deferred
  // History keeps no M3U entry URL: it is looked up in the loaded playlist,
  // waiting for the playlist when the tile is clicked before it is in.
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
            if (!entry) return null
            return {
              ...channel,
              streamUrl: entry.streamUrl,
              ...(entry.httpHeaders ? { httpHeaders: entry.httpHeaders } : {}),
              // An episode of a series gathered from the list: "next" and the subtitle memory go by its series.
              ...(entry.seriesRef ? { seriesRef: entry.seriesRef } : {})
            }
          }
        },
        (resolved) => openPlayback({ target, channel: resolved })
      )
    },
    [openPlayback, playWhenReady]
  )
  // The poster of an episode's tile: its series' page, on the season being watched.
  const handleOpenSeries = useCallback(
    (item: ContinueWatchingItem) => {
      const state = seriesRouteStateOf(item)
      if (state) void navigate('/series', { state })
    },
    [navigate]
  )
  // Starting over: without a saved position the player has nothing to resume
  // from, and the recorder writes a new entry as the film plays.
  const handleRestart = useCallback(
    (item: ContinueWatchingItem) => {
      removeWatchProgress(item.entry.key)
      handleContinue(item)
    },
    [removeWatchProgress, handleContinue]
  )

  const visibleLive = useVisibleCatalogItems(activeSourceId, 'live')
  const visibleVod = useVisibleCatalogItems(activeSourceId, 'vod')
  const visibleSeries = useVisibleCatalogItems(activeSourceId, 'series')
  const vodCategories = useVisibleCatalogCategories(activeSourceId, 'vod', INCLUDE_HIDDEN)
  const seriesCategories = useVisibleCatalogCategories(activeSourceId, 'series', INCLUDE_HIDDEN)
  const liveStatus = useCatalogStatus(activeSourceId, 'live')
  const vodStatus = useCatalogStatus(activeSourceId, 'vod')
  const seriesStatus = useCatalogStatus(activeSourceId, 'series')
  const totalCount = useStore((s) => sourceItemCount(s.catalogStatus, activeSourceId))

  const adultCategoryIds = useMemo(() => {
    const ids = new Set<string>()
    for (const category of [...vodCategories, ...seriesCategories]) if (category.isAdult) ids.add(category.id)
    return ids
  }, [vodCategories, seriesCategories])

  const home = useMemo(
    () => buildHomeCatalog({ live: visibleLive, vod: visibleVod, series: visibleSeries, totalCount, adultCategoryIds }),
    [visibleLive, visibleVod, visibleSeries, totalCount, adultCategoryIds]
  )
  usePerfMarkOnce('renderer:home-first-content', home.hasSourceContent)

  // The guide is read only when it is already in memory (the Yayın Akışı
  // screen loads it); the home screen never downloads one. Favourite channels
  // of this source come first: they are the ones the viewer cares about.
  const favorites = useFavoriteChannels()
  const guideChannels = useMemo(() => {
    if (!epgData) return []
    const favoriteLive = favorites.filter((channel) => channel.type === 'live' && channel.sourceId === activeSourceId)
    return [...favoriteLive, ...visibleLive]
  }, [epgData, favorites, activeSourceId, visibleLive])
  const guide = useMemo(() => findGuideHighlights(epgData, guideChannels, now), [epgData, guideChannels, now])
  const guideChannelCount = useMemo(() => countGuideChannels(epgData, visibleLive), [epgData, visibleLive])
  const handleFavorite = useOpenFavorite(handlePlay, playWhenReady)

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
  const continueItems = useMemo(
    () =>
      selectContinueWatching(watchProgress, {
        hasCredentials: (sourceId) => sourcesWithCredentials.has(sourceId),
        hasSource: (sourceId) => sourceIds.has(sourceId),
        findLegacyChannel: (entry) => legacyIndex.get(legacyIndexKey(entry)) ?? null,
        limit: CONTINUE_LIMIT
      }),
    [watchProgress, sourcesWithCredentials, sourceIds, legacyIndex]
  )
  // A tall window fills with the source's film categories, in the provider's
  // order, each a row of its films (hidden and adult categories left out).
  const viewSettings = useCatalogViewSettings()
  const visibleVodCategories = useVisibleCatalogCategories(activeSourceId, 'vod')
  const categoryRows = useMemo(() => {
    void catalogVersion
    const result: Array<{ categoryId: string; title: string; items: readonly Channel[] }> = []
    if (!activeSourceId) return result
    for (const category of visibleVodCategories) {
      if (result.length >= CATEGORY_ROWS) break
      if (category.isAdult) continue
      const items = catalog.getVisibleItems(activeSourceId, 'vod', viewSettings, category.id)
      if (items.length < CATEGORY_ROW_MIN) continue
      result.push({ categoryId: category.id, title: category.name, items: items.slice(0, HOME_MAX_FILMS) })
    }
    return result
  }, [catalogVersion, activeSourceId, visibleVodCategories, viewSettings])

  const continueItem = continueItems[0] ?? null
  const moreContinue = useMemo(() => continueItems.slice(1), [continueItems])

  // The channel panel of a wide window: this source's favourite channels
  // first, then its list in the provider's order, with what is on now when
  // the guide is in memory.
  const hasPanel = useMediaQuery(PANEL_QUERY)
  const favoriteLive = useMemo(
    () => favorites.filter((channel) => channel.type === 'live' && channel.sourceId === activeSourceId),
    [favorites, activeSourceId]
  )
  const panelChannels = useMemo((): PanelChannel[] => {
    const seen = new Set<string>()
    const result: PanelChannel[] = []
    const add = (channel: Channel, favorite: boolean) => {
      if (seen.has(channel.id) || result.length >= PANEL_CHANNELS) return
      seen.add(channel.id)
      const programs = epgData ? channelPrograms(epgData.programs, channel) : undefined
      const onAir = programs ? findCurrentProgram(programs, now) : null
      result.push({ channel, favorite, now: onAir?.title ?? null })
    }
    for (const channel of favoriteLive) add(channel, true)
    for (const channel of visibleLive) {
      if (result.length >= PANEL_CHANNELS) break
      add(channel, false)
    }
    return result
  }, [favoriteLive, visibleLive, epgData, now])

  const hasNoContent = !home.hasSourceContent
  const isBusy = isLoading || isLoadingPlaylist || bootstrap.isBootstrapping
  const showInitialLoading = sources.length > 0 && hasNoContent && isBusy
  // `bootstrap.error` only covers the catalog fetch; connection failures live in
  // the auth slice, so a wrong password or a dead server shows here too.
  const blockingError = bootstrap.error ?? authError
  const showError = sources.length > 0 && !showInitialLoading && !!blockingError && hasNoContent

  let sourceState: HomeSourceState
  if (sources.length === 0) sourceState = 'none'
  else if (showError || activeSourceFailed) sourceState = 'failed'
  else if (isBusy) sourceState = 'loading'
  else sourceState = 'ready'

  const lines = describeTiles({
    source: sourceState,
    counts: home.counts,
    loaded: {
      live: liveStatus?.loaded === true,
      vod: vodStatus?.loaded === true,
      series: seriesStatus?.loaded === true
    },
    films: home.films,
    newestSeries: home.newestSeries,
    guide,
    guideChannels: guideChannelCount,
    formatTime: formatClockTime
  })

  let feature
  if (sources.length === 0) feature = <HomeWelcome />
  else if (showInitialLoading) {
    feature = (
      <HomeLoading isConnectingSources={isLoading && !isLoadingPlaylist} stage={bootstrap.stage} onRetry={bootstrap.retry} />
    )
  } else if (showError && blockingError) {
    feature = (
      <HomeError
        message={blockingError}
        onRetry={bootstrap.retry}
        detail={activeSourceRetryAt !== null ? text.autoRetry : undefined}
      />
    )
  } else if (continueItem) {
    feature = (
      <ContinueTile
        item={continueItem}
        onResume={handleContinue}
        onRestart={handleRestart}
        onRemove={removeWatchProgress}
        onOpenSeries={seriesRouteStateOf(continueItem) ? handleOpenSeries : undefined}
      />
    )
  } else if (home.films.items[0]) {
    feature = <NewestFilmTile film={home.films.items[0]} dated={home.films.dated} onPlay={handlePlay} />
  } else feature = <IdleTile />

  let source: { tone: SourceTone; text: string } | null = null
  if (activeSource) {
    const name = activeSource.name
    if (sourceState === 'failed') {
      source = { tone: 'failed', text: hasNoContent ? text.source.failed(name) : text.source.offline(name) }
    } else if (syncProgress?.active && syncProgress.currentType) {
      source = {
        tone: 'busy',
        text: text.syncLoading(
          syncProgress.completedTypes,
          TYPE_COUNT,
          strings.catalog.types[syncProgress.currentType].section
        )
      }
    } else if (isBusy) {
      source = { tone: 'busy', text: text.source.connecting(name) }
    } else {
      source = { tone: 'ok', text: activeSource.type === 'xtream' ? text.source.connected(name) : text.source.ready(name) }
    }
  }

  // Placeholders only while the films are really on their way: not for a
  // source that is down (the tiles say "Kaynak bekleniyor" instead).
  const filmsLoading =
    home.films.items.length === 0 &&
    sourceState !== 'failed' &&
    sourceState !== 'none' &&
    (bootstrap.loadingTypes.includes('vod') || (vodStatus?.loaded !== true && isBusy))
  // Before the list is in, name the row the way it will most likely be
  // named: Xtream lists carry dates, M3U playlists do not.
  const filmsDated = home.films.items.length > 0 ? home.films.dated : activeSource?.type === 'xtream'

  // The rows under the tiles, in order; HomeRows draws those that fit. A row
  // with nothing in it is not offered at all.
  // "Tümünü gör" on a row opens its section; on a category row, with that
  // category picked (the section keeps one selection per source).
  const openSection = (type: 'live' | 'vod' | 'series', categoryId: string | null) => () => {
    if (activeSourceId) setSelectedCategory(activeSourceId, type, categoryId)
  }
  const rows: HomeRow[] = []
  if (home.films.items.length > 0 || filmsLoading) {
    rows.push({
      id: 'films',
      title: filmsDated ? text.newestFilms : text.listFilms,
      shape: 'poster',
      tone: 'mint',
      link: { to: '/vod', onClick: openSection('vod', null) },
      items: home.films.items,
      loading: filmsLoading,
      onOpen: handlePlay
    })
  }
  if (home.newestSeries.items.length > 0) {
    rows.push({
      id: 'series',
      title: home.newestSeries.dated ? text.newestSeries : text.listSeries,
      shape: 'poster',
      tone: 'sky',
      link: { to: '/series', onClick: openSection('series', null) },
      items: home.newestSeries.items,
      onOpen: handlePlay
    })
  }
  if (moreContinue.length > 0) {
    const byChannel = new Map(moreContinue.map((item) => [item.channel.id, item]))
    rows.push({
      id: 'continue',
      title: text.continueRow,
      shape: 'poster',
      // Sun: progress, as on the continue tile.
      tone: 'sun',
      items: moreContinue.map((item) => item.channel),
      onOpen: (channel) => {
        const item = byChannel.get(channel.id)
        if (item) handleContinue(item)
      }
    })
  }
  if (favorites.length >= FAVORITES_ROW_MIN) {
    rows.push({
      id: 'favorites',
      title: text.favoritesRow,
      shape: 'logo',
      // The star of the home bar's Favoriler pill.
      tone: 'sun',
      link: { to: '/favorites' },
      items: favorites,
      onOpen: handleFavorite
    })
  }
  for (const row of categoryRows) {
    rows.push({
      id: `category-${row.categoryId}`,
      title: row.title,
      shape: 'poster',
      tone: 'mint',
      link: { to: '/vod', onClick: openSection('vod', row.categoryId) },
      items: row.items,
      onOpen: handlePlay
    })
  }
  // The channel panel lists them already when the window is wide enough for it.
  if (!hasPanel && visibleLive.length > 0) {
    rows.push({
      id: 'channels',
      title: text.channelsRow,
      shape: 'logo',
      tone: 'coral',
      link: { to: '/live', onClick: openSection('live', null) },
      items: visibleLive,
      onOpen: handlePlay
    })
  }

  return (
    // The full width (centred only past 2400 px). A bigger window gets more
    // of the source's content (a channel panel, more posters, more rows),
    // not bigger tiles: see HomeStage.
    <div onKeyDown={onArrowKey} className="mx-auto flex h-full w-full max-w-[2400px] flex-col gap-5 short:gap-4">
      <h1 className="sr-only">{text.pageTitle}</h1>

      {bootstrap.partialError && <HomeNotice message={bootstrap.partialError} onRetry={bootstrap.retry} />}
      {deferred.notice && (
        <HomeNotice
          message={deferred.notice.message}
          tone={deferred.notice.pending ? 'info' : 'error'}
          onDismiss={deferred.dismissNotice}
        />
      )}

      <HomeStage
        rows={rows}
        source={source}
        withPanel={sources.length > 0 && panelChannels.length > 0}
        block={
          <>
            {feature}
            <HomeTiles lines={lines} />
            {sources.length > 0 && panelChannels.length > 0 && (
              <HomeChannelPanel channels={panelChannels} hasFavorites={favoriteLive.length > 0} onPlay={handlePlay} />
            )}
          </>
        }
      />
    </div>
  )
}
