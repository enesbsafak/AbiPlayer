import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useStore } from '@/store'
import {
  addonEpisodeChannel,
  addonEpisodeTarget,
  addonMetaToSeriesDetail,
  loadAddonMeta,
  loadAddonSeasonEpisodes
} from '@/addons/detail'
import { addonErrorMessage } from '@/addons/messages'
import { isTmdbCatalogSource } from '@/addons/builtin'
import type { AddonMeta } from '@/addons/client'
import { appCatalogProvider, useCatalogSourceReady } from '@/addons/pager'
import { resolveTmdbApiKey, resolveTmdbLanguage, resolveTmdbTvDetails } from '@/services/tmdb-api'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { WatchProgressEntry } from '@/services/watch-progress'
import type { Channel, EpisodeInfo, SeriesDetail as SeriesDetailType } from '@/types/playlist'
import { mediaKey, type AddonPlaybackTarget } from '../../../../shared/playback'
import { strings } from '@/strings'
import { SeriesDetailView } from './SeriesDetail'

const text = strings.catalog.addon

// The interface is Turkish only; there is no language setting to follow.
const TMDB_LANGUAGE = resolveTmdbLanguage('tr')

/** One episode of an add-on series to play: its target, what the player shows, and its season. */
export interface AddonEpisodeRequest {
  target: AddonPlaybackTarget
  channel: Channel
  season: number
}

interface AddonSeriesDetailProps {
  /** The series' list record (or its favourite snapshot): what the card knows. */
  item: Channel
  metaId: string
  initialSeasonNumber?: number
  onBack: () => void
  onSeasonChange?: (seasonNumber: number) => void
  onPlayEpisode: (request: AddonEpisodeRequest) => void
  onOpenSeries?: (series: Channel) => void
}

/** What the card knows, as a detail without episodes. */
export function seriesDetailFromCard(item: Channel): SeriesDetailType {
  return {
    seriesId: 0,
    name: item.name,
    cover: item.coverUrl || item.logo || '',
    plot: '',
    cast: '',
    director: '',
    genre: '',
    releaseDate: item.year ?? '',
    rating: item.rating ?? '',
    backdropPath: [],
    seasons: [],
    episodes: {}
  }
}

/** The add-on's detail over the card's: the card fills what the meta left empty. */
export function withCardFallback(detail: SeriesDetailType, item: Channel): SeriesDetailType {
  const card = seriesDetailFromCard(item)
  return {
    ...detail,
    name: detail.name || card.name,
    cover: detail.cover || card.cover,
    releaseDate: detail.releaseDate || card.releaseDate,
    rating: detail.rating || card.rating
  }
}

/**
 * The season shown first: the one asked for when the series has it, else
 * the one last watched (`watched`), else the first.
 */
export function initialSeasonOf(detail: SeriesDetailType, requested: number | undefined, watched?: number | null): number {
  const has = (season: number | null | undefined): season is number =>
    typeof season === 'number' && detail.seasons.some((entry) => entry.seasonNumber === season)
  if (has(requested)) return requested
  if (has(watched)) return watched
  return detail.seasons[0]?.seasonNumber ?? 1
}

/**
 * The season of the series' episode watched last, from the watch history:
 * an add-on episode's video id ends in `:<season>:<episode>`.
 */
export function lastWatchedSeason(entries: readonly WatchProgressEntry[], sourceId: string, metaId: string): number | null {
  let latest: WatchProgressEntry | null = null
  for (const entry of entries) {
    const target = entry.target
    if (target?.kind !== 'addon' || target.sourceId !== sourceId || target.metaId !== metaId || target.contentType !== 'series') continue
    if (!latest || entry.updatedAt > latest.updatedAt) latest = entry
  }
  const target = latest?.target
  const match = target?.kind === 'addon' ? /:(\d+):\d+$/.exec(target.videoId) : null
  return match ? Number(match[1]) : null
}

/** Where loading one season's episodes stands (series whose meta lists seasons without them). */
type SeasonLoad = { status: 'loading' } | { status: 'failed'; message: string }

type EpisodesProblem = 'unavailable' | 'failed' | null

interface LoadState {
  detail: SeriesDetailType | null
  problem: EpisodesProblem
  message: string | null
  /** The meta, when its seasons' episodes are fetched one season at a time. */
  lazyMeta: AddonMeta | null
}

/**
 * An add-on series: its detail and episodes from the meta of the add-on it
 * was listed by (its seasons, "Özel bölümler" for season 0), with the
 * optional TMDB text on top as for an Xtream series. Without a meta the
 * card's own data shows and the page says why there are no episodes.
 *
 * A series of the built-in TMDB catalogue is TMDB's already (no second TMDB
 * text on top); its seasons are listed at once and each season's episodes
 * are fetched when the season is opened. Without an IMDb id no stream
 * add-on can be asked for its episodes: playing one says so instead.
 */
export function AddonSeriesDetail({
  item,
  metaId,
  initialSeasonNumber,
  onBack,
  onSeasonChange,
  onPlayEpisode,
  onOpenSeries
}: AddonSeriesDetailProps) {
  const sourceId = item.sourceId
  // The add-on's address is in memory (or, for the TMDB catalogue, a key is saved).
  const addonReady = useCatalogSourceReady(sourceId)
  const credentialsHydrated = useStore((s) => s.credentialsHydrated)
  const tmdbApiKeySetting = useStore((s) => s.settings.tmdbApiKey)
  const watchProgress = useStore((s) => s.watchProgress)
  const [state, setState] = useState<LoadState>({ detail: null, problem: null, message: null, lazyMeta: null })
  const [selectedSeason, setSelectedSeason] = useState(1)
  const [reloadToken, reload] = useReducer((value: number) => value + 1, 0)
  const [seasonLoads, setSeasonLoads] = useState<Record<number, SeasonLoad>>({})
  const [seasonRetry, retrySeason] = useReducer((value: number) => value + 1, 0)
  const [playNotice, setPlayNotice] = useState<string | null>(null)
  // Loaded per series: a later sync replacing the card's record must not reload it.
  const itemRef = useRef(item)
  const initialSeasonRef = useRef(initialSeasonNumber)
  useEffect(() => {
    itemRef.current = item
    initialSeasonRef.current = initialSeasonNumber
  })

  const waitingForAddress = !addonReady && !credentialsHydrated
  useEffect(() => {
    if (waitingForAddress) return
    let cancelled = false
    const controller = new AbortController()
    const card = itemRef.current
    setState({ detail: null, problem: null, message: null, lazyMeta: null })
    setSeasonLoads({})
    setPlayNotice(null)
    const load = async () => {
      let detail = seriesDetailFromCard(card)
      let problem: EpisodesProblem = null
      let message: string | null = null
      let lazyMeta: AddonMeta | null = null
      const source = useStore.getState().sources.find((entry) => entry.id === sourceId)
      const provider = appCatalogProvider(source)
      const builtin = isTmdbCatalogSource(source)
      try {
        const meta = source && provider ? await loadAddonMeta(source, 'series', metaId, { signal: controller.signal }, provider) : null
        if (cancelled) return
        if (meta) {
          detail = withCardFallback(addonMetaToSeriesDetail(meta), card)
          if (meta.seasons) lazyMeta = meta
        }
        // No address (its secret is missing; for the TMDB catalogue, no key): the meta could not be asked for.
        else problem = provider ? 'unavailable' : 'failed'
        if (!meta && builtin && !provider) message = strings.errors.tmdb.noKey
      } catch (error) {
        if (cancelled) return
        problem = 'failed'
        message = addonErrorMessage(error, text.episodesFailed)
        // The message holds no address (addons/request.ts).
        console.warn('[addon] series detail not loaded:', message)
      }

      const tmdbApiKey = resolveTmdbApiKey(tmdbApiKeySetting)
      // The TMDB catalogue's own detail is TMDB's text already.
      if (tmdbApiKey && detail.name && !builtin) {
        try {
          const tmdb = await resolveTmdbTvDetails({
            apiKey: tmdbApiKey,
            language: TMDB_LANGUAGE,
            name: detail.name,
            year: detail.releaseDate
          })
          if (tmdb && !cancelled) {
            detail = {
              ...detail,
              name: tmdb.name || detail.name,
              cover: tmdb.posterPath || detail.cover,
              plot: tmdb.overview || detail.plot,
              cast: tmdb.cast.join(', ') || detail.cast,
              director: tmdb.creators.join(', ') || detail.director,
              genre: tmdb.genres.join(', ') || detail.genre,
              releaseDate: tmdb.firstAirDate || detail.releaseDate,
              rating: typeof tmdb.rating === 'number' ? tmdb.rating.toFixed(1) : detail.rating
            }
          }
        } catch (error) {
          if (!cancelled) console.warn('TMDB enrichment failed for series detail', error)
        }
      }

      if (cancelled) return
      setState({ detail, problem, message, lazyMeta })
      // A season at a time (the TMDB catalogue): the one watched last, so its
      // "Devam et" is there without opening it. An add-on's series has every
      // episode at once and opens as it always did.
      const watched = lazyMeta ? lastWatchedSeason(useStore.getState().watchProgress, sourceId, metaId) : null
      setSelectedSeason(initialSeasonOf(detail, initialSeasonRef.current, watched))
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [sourceId, metaId, addonReady, waitingForAddress, tmdbApiKeySetting, reloadToken])

  // A season of a series whose meta lists seasons without episodes: its
  // episodes once it is opened. A failure is said in the list, with a retry.
  const { lazyMeta } = state
  const seasonLoaded = !!state.detail?.episodes[selectedSeason]
  const seasonListed = !!state.detail?.seasons.some((season) => season.seasonNumber === selectedSeason)
  useEffect(() => {
    if (!lazyMeta || seasonLoaded || !seasonListed) return
    const source = useStore.getState().sources.find((entry) => entry.id === sourceId)
    const provider = appCatalogProvider(source)
    if (!provider) {
      setSeasonLoads((loads) => ({ ...loads, [selectedSeason]: { status: 'failed', message: strings.errors.tmdb.noKey } }))
      return
    }
    const season = selectedSeason
    const controller = new AbortController()
    setSeasonLoads((loads) => ({ ...loads, [season]: { status: 'loading' } }))
    void loadAddonSeasonEpisodes(provider, lazyMeta, season, { signal: controller.signal }).then(
      (episodes) => {
        if (controller.signal.aborted) return
        setState((current) =>
          current.detail ? { ...current, detail: { ...current.detail, episodes: { ...current.detail.episodes, [season]: episodes } } } : current
        )
        setSeasonLoads((loads) => {
          const next = { ...loads }
          delete next[season]
          return next
        })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure = addonErrorMessage(error, strings.catalog.tmdb.seasonFailed)
        // The message holds no address and no key (addons/tmdb.ts).
        console.warn('[addon] season not loaded:', failure)
        setSeasonLoads((loads) => ({ ...loads, [season]: { status: 'failed', message: failure } }))
      }
    )
    return () => controller.abort()
  }, [lazyMeta, seasonLoaded, seasonListed, selectedSeason, sourceId, seasonRetry, addonReady])

  const { detail, problem, message } = state
  // The favourite keeps the meta's name and poster when the card had none (opened from a bare id).
  const favoriteItem = useMemo(
    () =>
      detail ? { ...item, name: item.name || detail.name, ...(item.coverUrl || !detail.cover ? {} : { coverUrl: detail.cover }) } : item,
    [item, detail]
  )

  if (!detail) return <div className="flex justify-center py-20"><Spinner size={32} /></div>

  const progressOf = (episode: EpisodeInfo): WatchProgressEntry | null => {
    const key = mediaKey(addonEpisodeTarget(sourceId, metaId, episode))
    return watchProgress.find((entry) => entry.key === key) ?? null
  }

  const play = (episode: EpisodeInfo) => {
    // A TMDB series without an IMDb id: no stream add-on can be asked.
    if (lazyMeta && lazyMeta.streamId === null) {
      setPlayNotice(strings.catalog.tmdb.noStreamId)
      return
    }
    onPlayEpisode({
      target: addonEpisodeTarget(sourceId, metaId, episode),
      channel: addonEpisodeChannel({ sourceId, seriesName: detail.name, episode, coverUrl: detail.cover }),
      season: episode.season
    })
  }

  const seasonLoad = seasonLoads[selectedSeason]
  const seasonNotice =
    seasonLoad?.status === 'failed' ? (
      <>
        <span>{seasonLoad.message}</span>
        <Button size="sm" variant="secondary" onClick={retrySeason}>
          {strings.common.retry}
        </Button>
      </>
    ) : lazyMeta && !detail.episodes[selectedSeason] ? (
      <span className="flex items-center gap-2.5">
        <Spinner size={16} />
        {strings.catalog.tmdb.seasonLoading}
      </span>
    ) : null

  const notice =
    problem === 'unavailable' ? (
      <span>{text.episodesUnavailable}</span>
    ) : problem === 'failed' ? (
      <>
        <span>{message ?? text.episodesFailed}</span>
        <Button size="sm" variant="secondary" onClick={reload}>
          {strings.common.retry}
        </Button>
      </>
    ) : null

  return (
    <SeriesDetailView
      detail={detail}
      selectedSeason={selectedSeason}
      onSelectSeason={(season) => {
        setSelectedSeason(season)
        onSeasonChange?.(season)
      }}
      onBack={onBack}
      progressOf={progressOf}
      onPlay={play}
      favorite={favoriteItem.name ? { channelId: item.id, item: favoriteItem } : null}
      moreItem={item.categoryId ? item : null}
      onOpenSeries={onOpenSeries}
      episodesNotice={notice}
      seasonNotice={seasonNotice}
      playNotice={playNotice}
    />
  )
}
