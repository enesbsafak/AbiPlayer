import { useState, useReducer, useEffect, useRef, type ReactNode } from 'react'
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
import { useCatalogItem, xtreamItemId } from '@/catalog'
import type { Channel, EpisodeInfo, SeasonInfo, SeriesDetail as SeriesDetailType } from '@/types/playlist'
import { BackPill, DETAIL_PRIMARY, DetailPoster, DetailTitle, FactPill, MoreInCategory, WatchLine } from '@/components/vod/DetailParts'
import { episodeKey, watchShareOf } from '@/components/vod/watch-share'
import type { WatchProgressEntry } from '@/services/watch-progress'
import type { EpisodePlaybackRequest } from '@/types/player'
import { LOCALE, strings } from '@/strings'

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
  /** Opens another series' detail, from the row under the episodes. */
  onOpenSeries?: (series: Channel) => void
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
  if (!detail) return <SeriesDetailFailure message={loadError || text.seriesLoadFailed} onRetry={retry} onBack={onBack} />

  // The history of this series' episodes, by the media key the player keys
  // them with: progress on each row, and where "Devam et" picks up.
  const progressOf = (episode: EpisodeInfo): WatchProgressEntry | null => {
    const episodeId = parseEpisodeId(episode.id)
    if (episodeId === null) return null
    const key = episodeKey(sourceId, episodeId)
    return watchProgress.find((entry) => entry.key === key) ?? null
  }

  const play = (ep: EpisodeInfo) => {
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

/** The detail could not be loaded: says why, with a retry and the way back. */
export function SeriesDetailFailure({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <BackPill onBack={onBack} />
      <div role="alert" className="flex flex-col items-center gap-4 rounded-tile bg-raised px-8 py-12 text-center">
        <p className="font-title text-[28px]">{message}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button variant="primary" onClick={onRetry}>
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

/** A calendar date ("2024-03-12") as the interface writes dates ("12.03.2024"); other text as it is. */
function formatAirDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  const [, year, month, day] = match
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(LOCALE)
}

/** A season's pill: its own name, else "Sezon n"; season 0 holds the specials. */
export function seasonLabel(season: Pick<SeasonInfo, 'seasonNumber' | 'name'>): string {
  if (season.name) return season.name
  return season.seasonNumber === 0 ? strings.catalog.addon.specials : text.season(season.seasonNumber)
}

/** The primary action's episode, under it: "2. sezon 3. bölüm", or a special. */
function episodeLabel(episode: Pick<EpisodeInfo, 'season' | 'episodeNum'>): string {
  return episode.season === 0
    ? strings.catalog.addon.specialEpisodeLabel(episode.episodeNum)
    : text.playEpisodeLabel(episode.season, episode.episodeNum)
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
  /** What stands where the episodes would be, when there are none to show and the reason is known. */
  episodesNotice?: ReactNode
  /** What stands in the selected season's list while it has no episodes yet (loading, or failed). */
  seasonNotice?: ReactNode
  /** A line under the primary action (why an episode cannot be played, say). */
  playNotice?: ReactNode
}

/**
 * A series as the page shows it, wherever its detail came from (an Xtream
 * panel, an add-on's meta): poster and facts, the one primary action (the
 * episode to resume, else the first), seasons as pills, the episodes.
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
  onOpenSeries,
  episodesNotice,
  seasonNotice,
  playNotice
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
          {(detail.director || detail.cast) && (
            <div className="flex flex-col gap-1 text-[15px] text-surface-400">
              {detail.director && <span>{text.director(detail.director)}</span>}
              {detail.cast && <span>{text.cast(detail.cast)}</span>}
            </div>
          )}
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
              {episodeLabel(primaryEpisode)}
              {primaryEpisode.title ? ` · ${primaryEpisode.title}` : ''}
            </p>
          )}
          <div aria-live="polite" className="empty:hidden">
            {playNotice && (
              <p role="status" className="flex max-w-[68ch] items-start gap-2.5 text-[15px] text-surface-300">
                <span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full bg-sun" />
                <span>{playNotice}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {episodesNotice && detail.seasons.length === 0 && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card bg-raised px-5 py-4 text-[15px] text-surface-300">
          {episodesNotice}
        </div>
      )}

      {detail.seasons.length > 0 && (
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
                  {seasonLabel(s)}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {detail.seasons.length > 0 && (
        <section aria-labelledby="series-episodes" className="flex flex-col gap-3">
          <div className="flex h-7 items-center gap-3">
            <span aria-hidden="true" className="size-3 shrink-0 rounded-[4px] bg-sky" />
            <h2 id="series-episodes" className="font-title text-[23px] leading-[1.2]">
              {text.episodes}
            </h2>
            <span className="text-[15px] font-bold tabular-nums text-surface-500">{episodes.length}</span>
          </div>
          {seasonNotice && episodes.length === 0 && (
            <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card bg-raised px-5 py-4 text-[15px] text-surface-300">
              {seasonNotice}
            </div>
          )}
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
                      <span className="min-w-0 truncate text-[17px] font-bold">{text.episode(ep.episodeNum, ep.title)}</span>
                      {qualityLabel && <QualityBadge label={qualityLabel} className="shrink-0" />}
                    </span>
                    {ep.plot && <span className="truncate text-[15px] text-surface-400">{ep.plot}</span>}
                    {ep.airDate && <span className="text-sm text-surface-500">{strings.catalog.tmdb.airDate(formatAirDate(ep.airDate))}</span>}
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
      )}

      {moreItem && onOpenSeries && <MoreInCategory item={moreItem} onOpen={onOpenSeries} />}
    </div>
  )
}
