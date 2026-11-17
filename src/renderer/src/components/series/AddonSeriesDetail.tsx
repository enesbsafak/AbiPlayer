import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useStore } from '@/store'
import { addonEpisodeChannel, addonEpisodeTarget, addonMetaToSeriesDetail, loadAddonMeta } from '@/addons/detail'
import { addonErrorMessage } from '@/addons/messages'
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

/** The season shown first: the one asked for when the series has it, else the first. */
export function initialSeasonOf(detail: SeriesDetailType, requested: number | undefined): number {
  if (typeof requested === 'number' && detail.seasons.some((season) => season.seasonNumber === requested)) return requested
  return detail.seasons[0]?.seasonNumber ?? 1
}

type EpisodesProblem = 'unavailable' | 'failed' | null

interface LoadState {
  detail: SeriesDetailType | null
  problem: EpisodesProblem
  message: string | null
}

/**
 * An add-on series: its detail and episodes from the meta of the add-on it
 * was listed by (its seasons, "Özel bölümler" for season 0), with the
 * optional TMDB text on top as for an Xtream series. Without a meta the
 * card's own data shows and the page says why there are no episodes.
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
  const addonReady = useStore((s) => !!s.sources.find((source) => source.id === sourceId)?.url)
  const credentialsHydrated = useStore((s) => s.credentialsHydrated)
  const tmdbApiKeySetting = useStore((s) => s.settings.tmdbApiKey)
  const watchProgress = useStore((s) => s.watchProgress)
  const [state, setState] = useState<LoadState>({ detail: null, problem: null, message: null })
  const [selectedSeason, setSelectedSeason] = useState(1)
  const [reloadToken, reload] = useReducer((value: number) => value + 1, 0)
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
    setState({ detail: null, problem: null, message: null })
    const load = async () => {
      let detail = seriesDetailFromCard(card)
      let problem: EpisodesProblem = null
      let message: string | null = null
      const source = useStore.getState().sources.find((entry) => entry.id === sourceId)
      try {
        const meta = source?.url ? await loadAddonMeta(source, 'series', metaId, { signal: controller.signal }) : null
        if (cancelled) return
        if (meta) detail = withCardFallback(addonMetaToSeriesDetail(meta), card)
        // No address (its secret is missing): the meta could not be asked for.
        else problem = source?.url ? 'unavailable' : 'failed'
      } catch (error) {
        if (cancelled) return
        problem = 'failed'
        message = addonErrorMessage(error, text.episodesFailed)
        // The message holds no address (addons/request.ts).
        console.warn('[addon] series detail not loaded:', message)
      }

      const tmdbApiKey = resolveTmdbApiKey(tmdbApiKeySetting)
      if (tmdbApiKey && detail.name) {
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
      setState({ detail, problem, message })
      setSelectedSeason(initialSeasonOf(detail, initialSeasonRef.current))
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [sourceId, metaId, addonReady, waitingForAddress, tmdbApiKeySetting, reloadToken])

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

  const play = (episode: EpisodeInfo) =>
    onPlayEpisode({
      target: addonEpisodeTarget(sourceId, metaId, episode),
      channel: addonEpisodeChannel({ sourceId, seriesName: detail.name, episode, coverUrl: detail.cover }),
      season: episode.season
    })

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
    />
  )
}
