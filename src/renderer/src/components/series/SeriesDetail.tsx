import { useState, useReducer, useEffect, useRef } from 'react'
import { Play, ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import {
  resolveTmdbApiKey,
  resolveTmdbLanguage,
  resolveTmdbSeasonEpisodes,
  resolveTmdbTvDetails
} from '@/services/tmdb-api'
import { LazyImage } from '@/components/ui/LazyImage'
import { Button } from '@/components/ui/Button'
import { FavoriteToggle } from '@/components/ui/FavoriteToggle'
import { QualityBadge } from '@/components/ui/QualityBadge'
import { Spinner } from '@/components/ui/Spinner'
import { inferContentQualityLabel } from '@/services/quality'
import { toUserMessage } from '@/services/user-error'
import { useCatalogItem, xtreamItemId } from '@/catalog'
import type { SeriesDetail as SeriesDetailType } from '@/types/playlist'
import type { EpisodePlaybackRequest } from '@/types/player'
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
  onPlayEpisode: (episode: EpisodePlaybackRequest) => void
}

type SeasonRaw = { season_number?: number; name?: string; episode_count?: number; cover?: string }
type EpisodeRaw = {
  id?: string | number
  episode_num?: number
  title?: string
  container_extension?: string
  season?: number
  info?: {
    plot?: string
    duration?: string
    duration_secs?: number
    rating?: number
    movie_image?: string
  }
}

function normalizeSeasons(raw: unknown): SeasonRaw[] {
  // Some Xtream servers return `seasons` as an object keyed by season number,
  // others as an array, others omit it entirely. Normalize to an array.
  if (Array.isArray(raw)) return raw as SeasonRaw[]
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, SeasonRaw>)
  return []
}

function normalizeEpisodeMap(raw: unknown): Record<string, EpisodeRaw[]> {
  // PHP-backed servers return `episodes: []` (empty array) instead of `{}`
  // when the series has no episodes. Also some return episode lists as
  // objects keyed by episode_num. Normalize each season to an array.
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, EpisodeRaw[]> = {}
  const entries = Array.isArray(raw)
    ? raw.map((v, i) => [String(i + 1), v] as const)
    : Object.entries(raw as Record<string, unknown>)
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      result[key] = value as EpisodeRaw[]
    } else if (value && typeof value === 'object') {
      result[key] = Object.values(value as Record<string, EpisodeRaw>)
    }
  }
  return result
}

function normalizeInfoObject(raw: unknown): Record<string, unknown> {
  // `info.info` is sometimes serialized as `[]` (empty array) by PHP when the
  // upstream record has no metadata. Treat anything non-object-like as empty.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

function parseEpisodeId(id: unknown): number | null {
  if (typeof id === 'number' && Number.isFinite(id)) return id
  if (typeof id === 'string') {
    const n = parseInt(id, 10)
    if (Number.isFinite(n)) return n
  }
  return null
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

        const rawInfo = normalizeInfoObject((info as { info?: unknown }).info)
        const rawSeasons = normalizeSeasons((info as { seasons?: unknown }).seasons)
        const rawEpisodes = normalizeEpisodeMap((info as { episodes?: unknown }).episodes)

        const seasons = rawSeasons.flatMap((season) => {
          if (typeof season.season_number !== 'number') return []
          return [{
            seasonNumber: season.season_number,
            name: season.name || '',
            episodeCount: season.episode_count || 0,
            cover: season.cover || ''
          }]
        })

        const episodes: Record<number, SeriesDetailType['episodes'][number]> = {}
        for (const [seasonNum, eps] of Object.entries(rawEpisodes)) {
          const seasonKey = parseInt(seasonNum, 10)
          if (!Number.isFinite(seasonKey)) continue
          episodes[seasonKey] = eps
            .map((ep) => {
              const streamId = parseEpisodeId(ep.id)
              if (streamId === null) return null
              return {
                id: typeof ep.id === 'string' ? ep.id : String(ep.id ?? streamId),
                episodeNum: ep.episode_num ?? 0,
                title: ep.title || '',
                containerExtension: ep.container_extension || 'mp4',
                plot: ep.info?.plot || '',
                duration: ep.info?.duration || '',
                durationSecs: ep.info?.duration_secs || 0,
                rating: ep.info?.rating || 0,
                season: ep.season ?? seasonKey,
                coverUrl: ep.info?.movie_image || '',
                streamUrl: xtreamApi.buildSeriesUrl(creds, streamId, ep.container_extension || 'mp4')
              }
            })
            .filter((e): e is NonNullable<typeof e> => e !== null)
        }

        // If seasons array is empty but episodes were returned, synthesize
        // seasons from the episode map so the UI still has something to show.
        const seasonsFromEpisodes =
          seasons.length === 0
            ? Object.keys(episodes)
                .flatMap((key) => {
                  const seasonNumber = parseInt(key, 10)
                  return Number.isFinite(seasonNumber) ? [seasonNumber] : []
                })
                .sort((a, b) => a - b)
                .map((seasonNumber) => ({
                  seasonNumber,
                  name: text.season(seasonNumber),
                  episodeCount: episodes[seasonNumber]?.length ?? 0,
                  cover: ''
                }))
            : seasons

        const rawName = typeof rawInfo.name === 'string' ? rawInfo.name : ''
        const rawCover = typeof rawInfo.cover === 'string' ? rawInfo.cover : ''
        const rawPlot = typeof rawInfo.plot === 'string' ? rawInfo.plot : ''
        const rawCast = typeof rawInfo.cast === 'string' ? rawInfo.cast : ''
        const rawDirector = typeof rawInfo.director === 'string' ? rawInfo.director : ''
        const rawGenre = typeof rawInfo.genre === 'string' ? rawInfo.genre : ''
        const rawReleaseDate = typeof rawInfo.release_date === 'string' ? rawInfo.release_date : ''
        const rawRating =
          typeof rawInfo.rating === 'string'
            ? rawInfo.rating
            : typeof rawInfo.rating === 'number'
              ? String(rawInfo.rating)
              : ''
        const rawBackdrop = Array.isArray(rawInfo.backdrop_path)
          ? (rawInfo.backdrop_path as unknown[]).filter((x): x is string => typeof x === 'string')
          : []

        let nextDetail: SeriesDetailType = {
          seriesId,
          name: rawName,
          cover: rawCover,
          plot: rawPlot,
          cast: rawCast,
          director: rawDirector,
          genre: rawGenre,
          releaseDate: rawReleaseDate,
          rating: rawRating,
          backdropPath: rawBackdrop,
          seasons: seasonsFromEpisodes,
          episodes
        }

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

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>
  if (!detail) {
    return (
      <div className="flex flex-col gap-4 py-12">
        <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
          <ArrowLeft size={16} /> {strings.common.back}
        </Button>
        <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-6 text-center text-red-200">
          <p className="text-sm font-medium">
            {loadError || text.seriesLoadFailed}
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button size="sm" variant="secondary" onClick={retry}>
              {strings.common.retry}
            </Button>
            <Button size="sm" variant="ghost" onClick={onBack}>
              {strings.common.goBack}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const episodes = detail.episodes[selectedSeason] || []

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
        <ArrowLeft size={16} /> {strings.common.back}
      </Button>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="shrink-0 w-48">
          <LazyImage src={detail.cover} alt={detail.name} className="aspect-[2/3] w-full rounded-lg" eager />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{detail.name}</h1>
          {detail.genre && <p className="text-sm text-accent">{detail.genre}</p>}
          {detail.plot && <p className="text-sm text-surface-400 leading-relaxed max-w-2xl">{detail.plot}</p>}
          <div className="flex gap-4 text-xs text-surface-500 mt-2">
            {detail.rating && <span>{text.rating(detail.rating)}</span>}
            {detail.director && <span>{text.director(detail.director)}</span>}
            {detail.releaseDate && <span>{detail.releaseDate}</span>}
          </div>
          {favoriteChannelId && (
            <FavoriteToggle channelId={favoriteChannelId} item={seriesItem} variant="button" className="mt-3 self-start" />
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {detail.seasons.map((s) => (
          <Button
            key={s.seasonNumber}
            variant={s.seasonNumber === selectedSeason ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => {
              setSelectedSeason(s.seasonNumber)
              onSeasonChange?.(s.seasonNumber)
            }}
          >
            {s.name || text.season(s.seasonNumber)}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {episodes.map((ep) => (
          (() => {
            const qualityLabel = inferContentQualityLabel(ep)

            return (
              <button
                key={ep.id}
                type="button"
                className="flex w-full items-center gap-4 rounded-lg border border-surface-800 bg-surface-900 p-3 text-left hover:border-surface-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={() => {
                  const episodeId = parseEpisodeId(ep.id)
                  if (episodeId === null) return
                  onPlayEpisode({
                    sourceId,
                    seriesId,
                    season: ep.season,
                    episodeNum: ep.episodeNum,
                    episodeId,
                    containerExtension: ep.containerExtension,
                    title: text.episodeTitle(detail.name, ep.season, ep.episodeNum, ep.title),
                    ...(ep.coverUrl ? { coverUrl: ep.coverUrl } : {}),
                    fallbackStreamUrl: ep.streamUrl
                  })
                }}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-800">
                  <Play size={16} className="text-accent" fill="currentColor" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 text-sm font-medium truncate">
                      {text.episode(ep.episodeNum, ep.title)}
                    </p>
                    {qualityLabel && (
                      <QualityBadge label={qualityLabel} className="shrink-0" />
                    )}
                  </div>
                  {ep.plot && <p className="text-xs text-surface-500 truncate">{ep.plot}</p>}
                </div>
                {ep.duration && <span className="text-xs text-surface-500 shrink-0">{ep.duration}</span>}
              </button>
            )
          })()
        ))}
      </div>
    </div>
  )
}
