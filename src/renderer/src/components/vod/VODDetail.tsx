import { useState, useEffect, useRef } from 'react'
import { Clock, Star } from 'lucide-react'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import {
  resolveTmdbApiKey,
  resolveTmdbLanguage,
  resolveTmdbMovieDetails
} from '@/services/tmdb-api'
import { FavoriteToggle } from '@/components/ui/FavoriteToggle'
import { PlayIcon } from '@/components/ui/icons'
import { QualityBadge } from '@/components/ui/QualityBadge'
import { Spinner } from '@/components/ui/Spinner'
import { inferContentQualityLabel } from '@/services/quality'
import { loadAddonMeta, addonMetaToVodInfo } from '@/addons/detail'
import { addonErrorMessage } from '@/addons/messages'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import { BackPill, DETAIL_PRIMARY, DetailPoster, DetailTitle, FactPill, MoreInCategory, WatchLine } from './DetailParts'
import { useItemProgress, watchShareOf } from './watch-share'

const text = strings.catalog.detail

// The interface is Turkish only; there is no language setting to follow.
const TMDB_LANGUAGE = resolveTmdbLanguage('tr')

interface VODDetailProps {
  item: Channel
  onBack: () => void
  onPlay: (item: Channel) => void
  /** Opens another film's detail, from the row under this one. */
  onOpen: (item: Channel) => void
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

export function VODDetail({ item, onBack, onPlay, onOpen }: VODDetailProps) {
  const [info, setInfo] = useState<VODInfo | null>(null)
  const share = watchShareOf(useItemProgress(item))
  const [loading, setLoading] = useState(true)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const tmdbApiKeySetting = useStore((s) => s.settings.tmdbApiKey)
  // An add-on film's detail comes from its add-on, once the add-on's address is in memory.
  const addonReady = useStore(
    (s) => item.addonMetaId !== undefined && !!s.sources.find((source) => source.id === item.sourceId)?.url
  )
  // Loaded per film id: the catalog replaces the record object on a full
  // sync, and that must not reload the detail on screen.
  const itemRef = useRef(item)
  useEffect(() => {
    itemRef.current = item
  })
  const itemId = item.id

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const item = itemRef.current
    const load = async () => {
      setLoading(true)
      setInfo(null)
      const creds = getXtreamCredentials(item.sourceId)
      let tmdbId: string | undefined
      // List records carry no detail text; it comes from get_vod_info below.
      let baseInfo: VODInfo = {
        name: item.name,
        plot: '',
        cast: '',
        director: '',
        genre: '',
        releaseDate: '',
        duration: '',
        rating: item.rating || '',
        year: item.year || '',
        cover: item.coverUrl || item.logo || ''
      }

      try {
        if (item.addonMetaId !== undefined) {
          // The add-on's meta, or (no meta resource, the add-on did not
          // answer) what the card knows: the film can be played either way.
          const source = useStore.getState().sources.find((entry) => entry.id === item.sourceId)
          const meta = source ? await loadAddonMeta(source, 'movie', item.addonMetaId, { signal: controller.signal }) : null
          if (cancelled) return
          if (meta) {
            const addonInfo = addonMetaToVodInfo(meta)
            baseInfo = {
              ...addonInfo,
              name: addonInfo.name || item.name,
              rating: addonInfo.rating || baseInfo.rating,
              year: addonInfo.year || baseInfo.year,
              cover: addonInfo.cover || baseInfo.cover
            }
          }
        } else if (creds && item.streamId) {
          const vodInfo = await xtreamApi.getVodInfo(creds, item.streamId, { signal: controller.signal })
          if (cancelled) return
          tmdbId = vodInfo.info?.tmdb_id
          baseInfo = {
            name: vodInfo.info?.name || item.name,
            plot: vodInfo.info?.plot || '',
            cast: vodInfo.info?.cast || '',
            director: vodInfo.info?.director || '',
            genre: vodInfo.info?.genre || '',
            releaseDate: vodInfo.info?.release_date || '',
            duration: vodInfo.info?.duration || '',
            rating: vodInfo.info?.rating || item.rating || '',
            year: vodInfo.info?.year || item.year || '',
            cover: vodInfo.info?.movie_image || item.coverUrl || item.logo || ''
          }
        }
      } catch (err) {
        // An add-on's message holds no address (addons/request.ts); its error object is not logged.
        if (!cancelled && item.addonMetaId !== undefined) console.warn('[addon] film detail not loaded:', addonErrorMessage(err))
        else if (!cancelled) console.error('Failed to load VOD info:', err)
      }

      const tmdbApiKey = resolveTmdbApiKey(tmdbApiKeySetting)
      if (tmdbApiKey) {
        try {
          const tmdbDetails = await resolveTmdbMovieDetails({
            apiKey: tmdbApiKey,
            language: TMDB_LANGUAGE,
            tmdbId,
            name: baseInfo.name,
            year: baseInfo.year || baseInfo.releaseDate
          })
          if (tmdbDetails && !cancelled) {
            baseInfo = {
              ...baseInfo,
              name: tmdbDetails.title || baseInfo.name,
              plot: tmdbDetails.overview || baseInfo.plot,
              cast: tmdbDetails.cast.join(', ') || baseInfo.cast,
              director: tmdbDetails.directors.join(', ') || baseInfo.director,
              genre: tmdbDetails.genres.join(', ') || baseInfo.genre,
              releaseDate: tmdbDetails.releaseDate || baseInfo.releaseDate,
              duration: tmdbDetails.runtime ? text.minutes(tmdbDetails.runtime) : baseInfo.duration,
              rating:
                typeof tmdbDetails.rating === 'number'
                  ? tmdbDetails.rating.toFixed(1)
                  : baseInfo.rating,
              year:
                tmdbDetails.releaseDate?.slice(0, 4) ||
                baseInfo.year,
              cover: tmdbDetails.posterPath || baseInfo.cover
            }
          }
        } catch (error) {
          if (!cancelled) console.warn('TMDB enrichment failed for movie detail', error)
        }
      }

      if (!cancelled) {
        setInfo(baseInfo)
        setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [itemId, getXtreamCredentials, tmdbApiKeySetting, addonReady])

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>

  const detail = info!
  const qualityLabel = inferContentQualityLabel(item)

  const genres = detail.genre ? detail.genre.split(',').map((genre) => genre.trim()).filter(Boolean) : []

  // The poster whole beside the text; the one primary action plays the film,
  // resuming it where it was left (the player does that) when it was started.
  return (
    // Centred past 1600 px: one item does not stretch across a very wide window.
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8">
      <BackPill onBack={onBack} />

      <div className="flex gap-8 max-md:flex-col">
        <DetailPoster src={detail.cover} />
        <div className="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4 min-[1800px]:max-w-[960px]">
          <DetailTitle>{detail.name}</DetailTitle>

          <div className="flex flex-wrap gap-2">
            {qualityLabel && <QualityBadge label={qualityLabel} />}
            {detail.rating && (
              <FactPill>
                <Star size={14} className="fill-sun text-sun" aria-hidden="true" />
                {detail.rating}
              </FactPill>
            )}
            {detail.year && <FactPill>{detail.year}</FactPill>}
            {detail.duration && (
              <FactPill>
                <Clock size={14} aria-hidden="true" /> {detail.duration}
              </FactPill>
            )}
            {genres.map((genre) => (
              <FactPill key={genre}>{genre}</FactPill>
            ))}
          </div>

          {share && <WatchLine share={share} label={text.watched(share.percent)} />}

          {detail.plot && <p className="max-w-[68ch] text-base leading-relaxed text-surface-300 min-[1800px]:text-lg">{detail.plot}</p>}

          {(detail.director || detail.cast || detail.releaseDate) && (
            <div className="flex flex-col gap-1 text-[15px] text-surface-400">
              {detail.director && <span>{text.director(detail.director)}</span>}
              {detail.cast && <span>{text.cast(detail.cast)}</span>}
              {detail.releaseDate && <span>{text.releaseDate(detail.releaseDate)}</span>}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => onPlay(item)} className={DETAIL_PRIMARY}>
              <PlayIcon size={22} />
              {share ? text.resume : text.playFilm}
            </button>
            <FavoriteToggle channelId={item.id} item={item} variant="button" className="h-[60px]" />
          </div>
        </div>
      </div>

      <MoreInCategory item={item} onOpen={onOpen} />
    </div>
  )
}
