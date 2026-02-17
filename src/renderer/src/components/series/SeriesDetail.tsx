import { useState, useEffect, useRef } from 'react'
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
import { Spinner } from '@/components/ui/Spinner'
import type { SeriesDetail as SeriesDetailType } from '@/types/playlist'

interface SeriesDetailProps {
  seriesId: number
  sourceId: string
  onBack: () => void
  onPlayEpisode: (url: string, title: string) => void
}

export function SeriesDetail({ seriesId, sourceId, onBack, onPlayEpisode }: SeriesDetailProps) {
  const [detail, setDetail] = useState<SeriesDetailType | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number>(1)
  const [tmdbTvId, setTmdbTvId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const hydratedSeasonsRef = useRef(new Set<number>())
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const settings = useStore((s) => s.settings)

  useEffect(() => {
    let cancelled = false
    hydratedSeasonsRef.current.clear()
    const load = async () => {
      setLoading(true)
      setDetail(null)
      setTmdbTvId(null)
      const creds = getXtreamCredentials(sourceId)
      if (!creds) {
        setLoading(false)
        return
      }

      try {
        const info = await xtreamApi.getSeriesInfo(creds, seriesId)
        if (cancelled) return
        const seasons = info.seasons?.map((s) => ({
          seasonNumber: s.season_number,
          name: s.name,
          episodeCount: s.episode_count,
          cover: s.cover
        })) || []

        const episodes: Record<number, SeriesDetailType['episodes'][number]> = {}
        for (const [seasonNum, eps] of Object.entries(info.episodes || {})) {
          episodes[parseInt(seasonNum)] = eps.map((ep) => ({
            id: ep.id,
            episodeNum: ep.episode_num,
            title: ep.title,
            containerExtension: ep.container_extension,
            plot: ep.info?.plot || '',
            duration: ep.info?.duration || '',
            durationSecs: ep.info?.duration_secs || 0,
            rating: ep.info?.rating || 0,
            season: ep.season,
            coverUrl: ep.info?.movie_image || '',
            streamUrl: xtreamApi.buildSeriesUrl(creds, parseInt(ep.id), ep.container_extension)
          }))
        }

        let nextDetail: SeriesDetailType = {
          seriesId,
          name: info.info?.name || '',
          cover: info.info?.cover || '',
          plot: info.info?.plot || '',
          cast: info.info?.cast || '',
          director: info.info?.director || '',
          genre: info.info?.genre || '',
          releaseDate: info.info?.release_date || '',
          rating: info.info?.rating || '',
          backdropPath: info.info?.backdrop_path || [],
          seasons,
          episodes
        }

        const tmdbApiKey = resolveTmdbApiKey(settings.tmdbApiKey)
        if (tmdbApiKey) {
          try {
            const rawInfo = (info.info as unknown as Record<string, unknown>) || {}
            const tmdbDetails = await resolveTmdbTvDetails({
              apiKey: tmdbApiKey,
              language: resolveTmdbLanguage(settings.language),
              tmdbId: (rawInfo.tmdb_id as string | number | undefined) ?? (rawInfo.tmdb as string | number | undefined),
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
              setTmdbTvId(tmdbDetails.id)
            }
          } catch (error) {
            if (!cancelled) console.warn('TMDB enrichment failed for series detail', error)
          }
        }

        if (cancelled) return
        setDetail(nextDetail)

        if (seasons.length > 0) setSelectedSeason(seasons[0].seasonNumber)
      } catch (err) {
        if (!cancelled) console.error('Failed to load series info:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [seriesId, sourceId, getXtreamCredentials, settings.tmdbApiKey, settings.language])

  useEffect(() => {
    let cancelled = false
    const tmdbApiKey = resolveTmdbApiKey(settings.tmdbApiKey)
    if (!detail || !tmdbTvId || !tmdbApiKey) return
    if (!detail.episodes[selectedSeason]?.length) return
    if (hydratedSeasonsRef.current.has(selectedSeason)) return

    const hydrateSeason = async () => {
      try {
        const seasonEpisodes = await resolveTmdbSeasonEpisodes({
          apiKey: tmdbApiKey,
          language: resolveTmdbLanguage(settings.language),
          tmdbTvId,
          seasonNumber: selectedSeason
        })
        if (cancelled || seasonEpisodes.length === 0) return

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
                  ? `${tmdbEpisode.runtime} dk`
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

        hydratedSeasonsRef.current.add(selectedSeason)
      } catch (error) {
        if (!cancelled) console.warn('TMDB season enrichment failed', error)
      }
    }

    void hydrateSeason()
    return () => {
      cancelled = true
    }
  }, [detail, selectedSeason, settings.language, settings.tmdbApiKey, tmdbTvId])

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>
  if (!detail) return <div className="text-center py-20 text-surface-500">Dizi detayi yuklenemedi</div>

  const episodes = detail.episodes[selectedSeason] || []

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
        <ArrowLeft size={16} /> Geri
      </Button>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="shrink-0 w-48">
          <LazyImage src={detail.cover} alt={detail.name} className="aspect-[2/3] w-full rounded-xl" eager />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{detail.name}</h1>
          {detail.genre && <p className="text-sm text-accent">{detail.genre}</p>}
          {detail.plot && <p className="text-sm text-surface-400 leading-relaxed max-w-2xl">{detail.plot}</p>}
          <div className="flex gap-4 text-xs text-surface-500 mt-2">
            {detail.rating && <span>Puan: {detail.rating}</span>}
            {detail.director && <span>Yonetmen: {detail.director}</span>}
            {detail.releaseDate && <span>{detail.releaseDate}</span>}
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {detail.seasons.map((s) => (
          <Button
            key={s.seasonNumber}
            variant={s.seasonNumber === selectedSeason ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSelectedSeason(s.seasonNumber)}
          >
            {s.name || `Sezon ${s.seasonNumber}`}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {episodes.map((ep) => (
          <div
            key={ep.id}
            className="flex items-center gap-4 rounded-lg border border-surface-800 bg-surface-900 p-3 hover:border-surface-600 transition-colors cursor-pointer"
            onClick={() => onPlayEpisode(ep.streamUrl, `${detail.name} - S${ep.season}E${ep.episodeNum} - ${ep.title}`)}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-800">
              <Play size={16} className="text-accent" fill="currentColor" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                E{ep.episodeNum}. {ep.title}
              </p>
              {ep.plot && <p className="text-xs text-surface-500 truncate">{ep.plot}</p>}
            </div>
            {ep.duration && <span className="text-xs text-surface-500 shrink-0">{ep.duration}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
