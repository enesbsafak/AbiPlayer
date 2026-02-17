import { useState, useEffect } from 'react'
import { Play, ArrowLeft, Clock, Star, Film } from 'lucide-react'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import { LazyImage } from '@/components/ui/LazyImage'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { Channel } from '@/types/playlist'

interface VODDetailProps {
  item: Channel
  onBack: () => void
  onPlay: (item: Channel) => void
}

interface VODInfo {
  name: string
  plot: string
  cast: string
  director: string
  genre: string
  releaseDate: string
  duration: string
  rating: string
  year: string
  cover: string
}

export function VODDetail({ item, onBack, onPlay }: VODDetailProps) {
  const [info, setInfo] = useState<VODInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const creds = getXtreamCredentials(item.sourceId)
      if (!creds || !item.streamId) {
        // Use existing channel data if no API access
        setInfo({
          name: item.name,
          plot: item.plot || '',
          cast: item.cast || '',
          director: item.director || '',
          genre: item.genre || '',
          releaseDate: item.releaseDate || '',
          duration: item.duration || '',
          rating: item.rating || '',
          year: item.year || '',
          cover: item.logo || item.coverUrl || ''
        })
        setLoading(false)
        return
      }

      try {
        const vodInfo = await xtreamApi.getVodInfo(creds, item.streamId)
        setInfo({
          name: vodInfo.info?.name || item.name,
          plot: vodInfo.info?.plot || item.plot || '',
          cast: vodInfo.info?.cast || item.cast || '',
          director: vodInfo.info?.director || item.director || '',
          genre: vodInfo.info?.genre || item.genre || '',
          releaseDate: vodInfo.info?.release_date || item.releaseDate || '',
          duration: vodInfo.info?.duration || item.duration || '',
          rating: vodInfo.info?.rating || item.rating || '',
          year: vodInfo.info?.year || item.year || '',
          cover: vodInfo.info?.movie_image || item.logo || item.coverUrl || ''
        })
      } catch (err) {
        console.error('Failed to load VOD info:', err)
        // Fallback to channel data
        setInfo({
          name: item.name,
          plot: item.plot || '',
          cast: item.cast || '',
          director: item.director || '',
          genre: item.genre || '',
          releaseDate: item.releaseDate || '',
          duration: item.duration || '',
          rating: item.rating || '',
          year: item.year || '',
          cover: item.logo || item.coverUrl || ''
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [item, getXtreamCredentials])

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>

  const detail = info!

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
        <ArrowLeft size={16} /> Back
      </Button>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="shrink-0 w-48">
          <LazyImage src={detail.cover} alt={detail.name} className="w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold">{detail.name}</h1>

          <div className="flex flex-wrap gap-3 text-xs text-surface-400">
            {detail.rating && (
              <span className="flex items-center gap-1">
                <Star size={12} className="fill-yellow-400 text-yellow-400" />
                {detail.rating}
              </span>
            )}
            {detail.year && <span>{detail.year}</span>}
            {detail.duration && (
              <span className="flex items-center gap-1">
                <Clock size={12} /> {detail.duration}
              </span>
            )}
          </div>

          {detail.genre && (
            <div className="flex flex-wrap gap-1.5">
              {detail.genre.split(',').map((g) => (
                <span key={g.trim()} className="rounded-full bg-surface-800 px-2.5 py-0.5 text-xs text-surface-300">
                  {g.trim()}
                </span>
              ))}
            </div>
          )}

          {detail.plot && (
            <p className="text-sm text-surface-400 leading-relaxed max-w-2xl">{detail.plot}</p>
          )}

          <div className="flex flex-col gap-1 text-xs text-surface-500 mt-1">
            {detail.director && <span>Director: {detail.director}</span>}
            {detail.cast && <span>Cast: {detail.cast}</span>}
            {detail.releaseDate && <span>Release: {detail.releaseDate}</span>}
          </div>

          <Button onClick={() => onPlay(item)} className="mt-4 self-start">
            <Play size={16} fill="currentColor" /> Play Movie
          </Button>
        </div>
      </div>
    </div>
  )
}
