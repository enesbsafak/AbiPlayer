import { useState, useEffect } from 'react'
import { Play, ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
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
  const [loading, setLoading] = useState(true)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const creds = getXtreamCredentials(sourceId)
      if (!creds) return

      try {
        const info = await xtreamApi.getSeriesInfo(creds, seriesId)
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

        setDetail({
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
        })

        if (seasons.length > 0) setSelectedSeason(seasons[0].seasonNumber)
      } catch (err) {
        console.error('Failed to load series info:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [seriesId, sourceId, getXtreamCredentials])

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>
  if (!detail) return <div className="text-center py-20 text-surface-500">Failed to load series</div>

  const episodes = detail.episodes[selectedSeason] || []

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
        <ArrowLeft size={16} /> Back
      </Button>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="shrink-0 w-48">
          <LazyImage src={detail.cover} alt={detail.name} className="w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{detail.name}</h1>
          {detail.genre && <p className="text-sm text-accent">{detail.genre}</p>}
          {detail.plot && <p className="text-sm text-surface-400 leading-relaxed max-w-2xl">{detail.plot}</p>}
          <div className="flex gap-4 text-xs text-surface-500 mt-2">
            {detail.rating && <span>Rating: {detail.rating}</span>}
            {detail.director && <span>Director: {detail.director}</span>}
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
            {s.name || `Season ${s.seasonNumber}`}
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
