import { useState, useReducer, useEffect, useRef } from 'react'
import { Play } from 'lucide-react'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import {
  resolveTmdbApiKey,
  resolveTmdbLanguage,
  resolveTmdbSeasonEpisodes,
  resolveTmdbTvDetails
} from '@/services/tmdb-api'
import { Button } from '@/components/ui/Button'
import { PlayIcon } from '@/components/ui/icons'
import { FavoriteToggle } from '@/components/ui/FavoriteToggle'
import { QualityBadge } from '@/components/ui/QualityBadge'
import { Spinner } from '@/components/ui/Spinner'
import { inferContentQualityLabel } from '@/services/quality'
import { toUserMessage } from '@/services/user-error'
import { episodeQueueOf, episodeRequestOf, parseEpisodeId, seriesDetailFromInfo } from '@/services/xtream-series'
import { useCatalogItem, xtreamItemId } from '@/catalog'
import type { Channel, EpisodeInfo, SeriesDetail as SeriesDetailType } from '@/types/playlist'
import { BackPill, DETAIL_PRIMARY, DetailPoster, DetailTitle, FactPill, MoreInCategory, WatchLine } from '@/components/vod/DetailParts'
import { episodeKey, watchShareOf } from '@/components/vod/watch-share'
import type { WatchProgressEntry } from '@/services/watch-progress'
import type { EpisodePlaybackRequest, QueuedEpisode } from '@/types/player'
import { strings } from '@/strings'

const text = strings.catalog.detail

// The interface is Turkish only; there is no language setting to follow.
const TMDB_LANGUAGE = resolveTmdbLanguage('tr')

interface SeriesDetailProps {
  seriesId: number
  sourceId: string
  initialSeasonNumber?: number
  onBack: () => void
  onSeasonChange?: (seasonNumber: number) => void
  /** The episode to play, identified by its own id rather than by a URL. */
  onPlayEpisode: (episode: EpisodePlaybackRequest, queue: QueuedEpisode[]) => void
  /** Opens another series' detail, from the row under the episodes. */
  onOpenSeries?: (series: Channel) => void
}

interface LoadStatus {
  loading: boolean
  error: string | null
}

type LoadStatusAction =
  | { type: 'loadStart' }
  | { type: 'loadFailed'; message: string }
  | { type: 'loadEnd' }
  | { type: 'loadAborted'; message: string }

const initialLoadStatus: LoadStatus = { loading: true, error: null }

function loadStatusReducer(state: LoadStatus, action: LoadStatusAction): LoadStatus {
  switch (action.type) {
    case 'loadStart':
      return { loading: true, error: null }
    case 'loadFailed':
      return { ...state, error: action.message }
    case 'loadEnd':
      return { ...state, loading: false }
    case 'loadAborted':
      return { loading: false, error: action.message }
    default:
      return state
  }
}

function useSeriesDetailData({
  seriesId,
  sourceId,
  initialSeasonNumber
}: Pick<SeriesDetailProps, 'seriesId' | 'sourceId' | 'initialSeasonNumber'>) {
  const [detail, setDetail] = useState<SeriesDetailType | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number>(1)
  const tmdbTvIdRef = useRef<number | null>(null)
  const [reloadToken, bumpReloadToken] = useReducer((value: number) => value + 1, 0)
  const [{ loading, error: loadError }, dispatchLoad] = useReducer(loadStatusReducer, initialLoadStatus)
  const hydratedSeasonsRef = useRef<Set<number> | null>(null)
  if (hydratedSeasonsRef.current === null) hydratedSeasonsRef.current = new Set<number>()
  const hydratedSeasons = hydratedSeasonsRef.current
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const credentialsHydrated = useStore((s) => s.credentialsHydrated)
  const tmdbApiKeySetting = useStore((s) => s.settings.tmdbApiKey)

  // The parent feeds every season click back as `initialSeasonNumber`. Reading
  // it through a ref keeps it out of the load effect's dependencies: as a
  // dependency it refetched the whole series on each click. A later reload
  // (retry, credentials arriving) still opens on the season last shown.
  const initialSeasonRef = useRef(initialSeasonNumber)
  useEffect(() => {
    initialSeasonRef.current = initialSeasonNumber
  }, [initialSeasonNumber])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    hydratedSeasons.clear()
    const load = async () => {
      dispatchLoad({ type: 'loadStart' })
      setDetail(null)
      tmdbTvIdRef.current = null
      const creds = getXtreamCredentials(sourceId)
      if (!creds) {
        // Distinguish "credentials not yet hydrated" (transient, auto-retries
        // once useAutoConnect finishes) from "source isn't xtream / missing
        // credentials" (permanent for this source).
        dispatchLoad({
          type: 'loadAborted',
          message: credentialsHydrated ? text.seriesNoCredentials : text.seriesCredentialsPending
        })
        return
      }

      try {
        const info = await xtreamApi.getSeriesInfo(creds, seriesId, { signal: controller.signal })
        if (cancelled) return

        const record = seriesDetailFromInfo(info, seriesId, (episodeId, extension) =>
          xtreamApi.buildSeriesUrl(creds, episodeId, extension)
        )
        const { rawInfo } = record
        let nextDetail: SeriesDetailType = record.detail

        const tmdbApiKey = resolveTmdbApiKey(tmdbApiKeySetting)
        if (tmdbApiKey) {
          try {
            const tmdbDetails = await resolveTmdbTvDetails({
              apiKey: tmdbApiKey,
              language: TMDB_LANGUAGE,
              tmdbId:
                (rawInfo.tmdb_id as string | number | undefined) ??
                (rawInfo.tmdb as string | number | undefined),
              name: nextDetail.name,
              year: nextDetail.releaseDate
            })
            if (tmdbDetails && !cancelled) {
              nextDetail = {
                ...nextDetail,
                name: tmdbDetails.name || nextDetail.name,
                cover: tmdbDetails.posterPath || nextDetail.cover,
                plot: tmdbDetails.overview || nextDetail.plot,
                cast: tmdbDetails.cast.join(', ') || nextDetail.cast,
                director: tmdbDetails.creators.join(', ') || nextDetail.director,
                genre: tmdbDetails.genres.join(', ') || nextDetail.genre,
                releaseDate: tmdbDetails.firstAirDate || nextDetail.releaseDate,
                rating:
                  typeof tmdbDetails.rating === 'number'
                    ? tmdbDetails.rating.toFixed(1)
                    : nextDetail.rating,
                backdropPath:
                  tmdbDetails.backdropPath
                    ? [tmdbDetails.backdropPath, ...nextDetail.backdropPath].filter(Boolean)
                    : nextDetail.backdropPath
              }
              tmdbTvIdRef.current = tmdbDetails.id
            }
          } catch (error) {
            if (!cancelled) console.warn('TMDB enrichment failed for series detail', error)
          }
        }

        if (cancelled) return
        setDetail(nextDetail)

        const availableSeasons = nextDetail.seasons
        const firstSeason = availableSeasons[0]
        if (firstSeason) {
          const requestedSeason = initialSeasonRef.current
          const preferredSeasonNumber =
            typeof requestedSeason === 'number' &&
            availableSeasons.some((season) => season.seasonNumber === requestedSeason)
              ? requestedSeason
              : firstSeason.seasonNumber

          setSelectedSeason(preferredSeasonNumber)
        }
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load series info:', err)
        dispatchLoad({ type: 'loadFailed', message: toUserMessage(err, text.seriesLoadFailed) })
      } finally {
        if (!cancelled) dispatchLoad({ type: 'loadEnd' })
      }
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    credentialsHydrated,
    getXtreamCredentials,
    hydratedSeasons,
    reloadToken,
    seriesId,
    tmdbApiKeySetting,
    sourceId
  ])

  useEffect(() => {
    let cancelled = false
    const tmdbApiKey = resolveTmdbApiKey(tmdbApiKeySetting)
    const tmdbTvId = tmdbTvIdRef.current
    if (!detail || !tmdbTvId || !tmdbApiKey) return
    if (!detail.episodes[selectedSeason]?.length) return
    if (hydratedSeasons.has(selectedSeason)) return

    const hydrateSeason = async () => {
      try {
        const seasonEpisodes = await resolveTmdbSeasonEpisodes({
          apiKey: tmdbApiKey,
          language: TMDB_LANGUAGE,
          tmdbTvId,
          seasonNumber: selectedSeason
        })
        if (cancelled) return
        if (seasonEpisodes.length === 0) return

        const episodesByNumber = new Map(
          seasonEpisodes.map((episode) => [episode.episodeNumber, episode])
        )

        setDetail((previous) => {
          if (!previous) return previous
          const existingSeasonEpisodes = previous.episodes[selectedSeason]
          if (!existingSeasonEpisodes?.length) return previous

          const mergedEpisodes = existingSeasonEpisodes.map((episode) => {
            const tmdbEpisode = episodesByNumber.get(episode.episodeNum)
            if (!tmdbEpisode) return episode

            return {
              ...episode,
              title: tmdbEpisode.name || episode.title,
              plot: tmdbEpisode.overview || episode.plot,
              duration:
                tmdbEpisode.runtime && tmdbEpisode.runtime > 0
                  ? text.minutes(tmdbEpisode.runtime)
                  : episode.duration,
              durationSecs:
                tmdbEpisode.runtime && tmdbEpisode.runtime > 0
                  ? tmdbEpisode.runtime * 60
                  : episode.durationSecs,
              rating:
                typeof tmdbEpisode.voteAverage === 'number' && tmdbEpisode.voteAverage > 0
                  ? tmdbEpisode.voteAverage
                  : episode.rating,
              coverUrl: tmdbEpisode.stillPath || episode.coverUrl
            }
          })

          return {
            ...previous,
            episodes: {
              ...previous.episodes,
              [selectedSeason]: mergedEpisodes
            }
          }
        })

        hydratedSeasons.add(selectedSeason)
      } catch (error) {
        if (!cancelled) console.warn('TMDB season enrichment failed', error)
      }
    }

    void hydrateSeason()
    return () => {
      cancelled = true
    }
  }, [detail, hydratedSeasons, selectedSeason, tmdbApiKeySetting])

  const retry = () => {
    bumpReloadToken()
    dispatchLoad({ type: 'loadStart' })
  }

  return {
    detail,
    loading,
    loadError,
    retry,
    selectedSeason,
    setSelectedSeason
  }
}

export function SeriesDetail({
  seriesId,
  sourceId,
  initialSeasonNumber,
  onBack,
  onOpenSeries,
  onSeasonChange,
  onPlayEpisode
}: SeriesDetailProps) {
  const {
    detail,
    loading,
    loadError,
    retry,
    selectedSeason,
    setSelectedSeason
  } = useSeriesDetailData({ seriesId, sourceId, initialSeasonNumber })
  // Offered for a series whose list record is in memory (the favourite keeps a
  // snapshot of it), and always for one that already is a favourite.
  const seriesItemId = xtreamItemId(sourceId, 'series', seriesId)
  const seriesItem = useCatalogItem(seriesItemId)
  const isSeriesFavorite = useStore((s) => s.favoriteIds.has(seriesItemId))
  const favoriteChannelId = seriesItem || isSeriesFavorite ? seriesItemId : null

  const watchProgress = useStore((s) => s.watchProgress)

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>
  if (!detail) {
    return (
      <div className="flex flex-col gap-6">
        <BackPill onBack={onBack} />
        <div role="alert" className="flex flex-col items-center gap-4 rounded-tile bg-raised px-8 py-12 text-center">
          <p className="font-title text-[28px]">{loadError || text.seriesLoadFailed}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" onClick={retry}>
              {strings.common.retry}
            </Button>
            <Button variant="secondary" onClick={onBack}>
              {strings.common.goBack}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // The history of this series' episodes, by the media key the player keys
  // them with: progress on each row, and where "Devam et" picks up.
  const progressOf = (episode: EpisodeInfo): WatchProgressEntry | null => {
    const episodeId = parseEpisodeId(episode.id)
    if (episodeId === null) return null
    const key = episodeKey(sourceId, episodeId)
    return watchProgress.find((entry) => entry.key === key) ?? null
  }

  const play = (ep: EpisodeInfo) => {
    const request = episodeRequestOf(sourceId, seriesId, detail.name, ep)
    if (request) onPlayEpisode(request, episodeQueueOf(sourceId, detail))
  }

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
      favorite={favoriteChannelId ? { channelId: favoriteChannelId, item: seriesItem } : null}
      moreItem={seriesItem ?? null}
      onOpenSeries={onOpenSeries}
    />
  )
}

export interface SeriesDetailViewProps {
  detail: SeriesDetailType
  selectedSeason: number
  onSelectSeason: (seasonNumber: number) => void
  onBack: () => void
  /** The history entry of an episode (its progress, and where "Devam et" picks up). */
  progressOf: (episode: EpisodeInfo) => WatchProgressEntry | null
  onPlay: (episode: EpisodeInfo) => void
  /** The favourite star, when the series can be a favourite. */
  favorite: { channelId: string; item?: Channel } | null
  /** The series' list record: the row of others from its category. */
  moreItem: Channel | null
  onOpenSeries?: (series: Channel) => void
}

/**
 * The series page itself: poster and facts, the seasons, the episodes of the
 * season shown. Where the series comes from (an Xtream account, an M3U list)
 * is the caller's business.
 */
export function SeriesDetailView({
  detail,
  selectedSeason,
  onSelectSeason,
  onBack,
  progressOf,
  onPlay,
  favorite,
  moreItem,
  onOpenSeries
}: SeriesDetailViewProps) {
  const episodes = detail.episodes[selectedSeason] || []
  const allEpisodes = detail.seasons.flatMap((season) => detail.episodes[season.seasonNumber] ?? [])
  let resumeEpisode: EpisodeInfo | null = null
  let resumedAt = -1
  for (const episode of allEpisodes) {
    const entry = progressOf(episode)
    if (entry && entry.updatedAt > resumedAt) {
      resumeEpisode = episode
      resumedAt = entry.updatedAt
    }
  }
  const firstEpisode = (detail.episodes[detail.seasons[0]?.seasonNumber ?? selectedSeason] ?? episodes)[0] ?? null
  const primaryEpisode = resumeEpisode ?? firstEpisode
  const genres = detail.genre ? detail.genre.split(',').map((genre) => genre.trim()).filter(Boolean) : []

  return (
    // Centred past 1600 px, like the film detail; the episodes fill the width in columns.
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8">
      <BackPill onBack={onBack} />

      <div className="flex gap-8 max-md:flex-col">
        <DetailPoster src={detail.cover} />
        <div className="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4 min-[1800px]:max-w-[960px]">
          <DetailTitle>{detail.name}</DetailTitle>
          <div className="flex flex-wrap gap-2">
            {detail.rating && <FactPill>{text.rating(detail.rating)}</FactPill>}
            {detail.releaseDate && <FactPill>{detail.releaseDate}</FactPill>}
            {genres.map((genre) => (
              <FactPill key={genre}>{genre}</FactPill>
            ))}
          </div>
          {detail.plot && <p className="max-w-[68ch] text-base leading-relaxed text-surface-300 min-[1800px]:text-lg">{detail.plot}</p>}
          {detail.director && <p className="text-[15px] text-surface-400">{text.director(detail.director)}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {primaryEpisode && (
              <button
                type="button"
                onClick={() => onPlay(primaryEpisode)}
                aria-describedby="series-primary-episode"
                className={DETAIL_PRIMARY}
              >
                <PlayIcon size={22} />
                {resumeEpisode ? text.resume : text.playFilm}
              </button>
            )}
            {favorite && (
              <FavoriteToggle channelId={favorite.channelId} item={favorite.item} variant="button" className="h-[60px]" />
            )}
          </div>
          {primaryEpisode && (
            <p id="series-primary-episode" className="text-[15px] text-surface-400">
              {text.playEpisodeLabel(primaryEpisode.season, primaryEpisode.episodeNum)}
              {primaryEpisode.title ? ` · ${primaryEpisode.title}` : ''}
            </p>
          )}
        </div>
      </div>

      <section aria-labelledby="series-seasons" className="flex flex-col gap-3">
        <div className="flex h-7 items-center gap-3">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-[4px] bg-sky" />
          <h2 id="series-seasons" className="font-title text-[23px] leading-[1.2]">
            {text.seasons}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {detail.seasons.map((s) => {
            const selected = s.seasonNumber === selectedSeason
            return (
              <button
                key={s.seasonNumber}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectSeason(s.seasonNumber)}
                className={`flex h-11 items-center rounded-full px-5 text-base ${
                  selected ? 'bg-sky font-bold text-ink' : 'bg-raised font-medium text-white hover:bg-surface-800'
                }`}
              >
                {s.name || text.season(s.seasonNumber)}
              </button>
            )
          })}
        </div>
      </section>

      <section aria-labelledby="series-episodes" className="flex flex-col gap-3">
        <div className="flex h-7 items-center gap-3">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-[4px] bg-sky" />
          <h2 id="series-episodes" className="font-title text-[23px] leading-[1.2]">
            {text.episodes}
          </h2>
          <span className="text-[15px] font-bold tabular-nums text-surface-500">{episodes.length}</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,560px),1fr))] gap-2.5">
          {episodes.map((ep) => {
            const qualityLabel = inferContentQualityLabel(ep)
            const share = watchShareOf(progressOf(ep))
            return (
              <button
                key={ep.id}
                type="button"
                className="flex min-h-[72px] w-full items-center gap-4 rounded-card bg-raised py-3 pl-3 pr-5 text-left transition-colors hover:bg-surface-800"
                onClick={() => onPlay(ep)}
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sky text-ink">
                  <Play size={18} fill="currentColor" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-[17px] font-bold">{ep.title ? text.episode(ep.episodeNum, ep.title) : text.episodeOnly(ep.episodeNum)}</span>
                    {qualityLabel && <QualityBadge label={qualityLabel} className="shrink-0" />}
                  </span>
                  {ep.plot && <span className="truncate text-[15px] text-surface-400">{ep.plot}</span>}
                  {share && (
                    <span className="mt-1 block max-w-[320px]">
                      <WatchLine share={share} label={text.watched(share.percent)} />
                    </span>
                  )}
                </span>
                {ep.duration && <span className="shrink-0 text-[15px] font-bold tabular-nums text-surface-400">{ep.duration}</span>}
              </button>
            )
          })}
        </div>
      </section>

      {moreItem && onOpenSeries && <MoreInCategory item={moreItem} onOpen={onOpenSeries} />}
    </div>
  )
}
