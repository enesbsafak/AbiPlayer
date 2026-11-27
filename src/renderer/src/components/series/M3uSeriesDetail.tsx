import { useMemo, useState } from 'react'
import { useStore } from '@/store'
import { useCatalogItem } from '@/catalog'
import { Button } from '@/components/ui/Button'
import { BackPill } from '@/components/vod/DetailParts'
import { m3uSeriesDetail, m3uSeriesQueue } from '@/services/m3u-series'
import type { WatchProgressEntry } from '@/services/watch-progress'
import type { Channel, EpisodeInfo } from '@/types/playlist'
import type { QueuedEpisode } from '@/types/player'
import { strings } from '@/strings'
import { SeriesDetailView } from './SeriesDetail'

const text = strings.catalog.detail

interface M3uSeriesDetailProps {
  /** The series item gathered from the playlist (services/m3u-series.ts). */
  itemId: string
  initialSeasonNumber?: number
  onBack: () => void
  onSeasonChange?: (seasonNumber: number) => void
  /** The episode to play and the series' episodes in order (the player's queue). */
  onPlayEpisode: (episode: QueuedEpisode, queue: QueuedEpisode[], season: number) => void
  onOpenSeries?: (series: Channel) => void
}

/**
 * A series gathered from an M3U list: the same page as an Xtream series,
 * with what a list knows (seasons, episodes, the poster) and nothing fetched.
 */
export function M3uSeriesDetail({ itemId, initialSeasonNumber, onBack, onSeasonChange, onPlayEpisode, onOpenSeries }: M3uSeriesDetailProps) {
  const item = useCatalogItem(itemId)
  const watchProgress = useStore((s) => s.watchProgress)
  const [chosenSeason, setChosenSeason] = useState<number | null>(null)

  const model = useMemo(() => {
    if (!item?.m3uEpisodes) return null
    const queue = m3uSeriesQueue(item)
    // The queue is in the episodes' order: the same index finds an episode's entry.
    const entryOf = new Map(item.m3uEpisodes.map((episode, index) => [episode.id, queue[index]]))
    return { detail: m3uSeriesDetail(item), queue, entryOf }
  }, [item])

  if (!item || !model) {
    // The playlist was refreshed and no longer lists it (or is still loading).
    return (
      <div className="flex flex-col gap-6">
        <BackPill onBack={onBack} />
        <div role="alert" className="flex flex-col items-center gap-4 rounded-tile bg-raised px-8 py-12 text-center">
          <p className="font-title text-[28px]">{text.playlistSeriesMissing}</p>
          <Button variant="secondary" onClick={onBack}>
            {strings.common.goBack}
          </Button>
        </div>
      </div>
    )
  }

  const { detail, queue, entryOf } = model
  const listed = (season: number | null | undefined): season is number =>
    typeof season === 'number' && detail.seasons.some((entry) => entry.seasonNumber === season)
  const selectedSeason = listed(chosenSeason)
    ? chosenSeason
    : listed(initialSeasonNumber)
      ? initialSeasonNumber
      : (detail.seasons[0]?.seasonNumber ?? 1)

  // The history of its episodes, by the media key the player keys them with.
  const progressOf = (episode: EpisodeInfo): WatchProgressEntry | null => {
    const key = entryOf.get(episode.id)?.mediaKey
    return key ? (watchProgress.find((entry) => entry.key === key) ?? null) : null
  }

  const play = (episode: EpisodeInfo) => {
    const entry = entryOf.get(episode.id)
    if (entry) onPlayEpisode(entry, queue, episode.season)
  }

  return (
    <SeriesDetailView
      detail={detail}
      selectedSeason={selectedSeason}
      onSelectSeason={(season) => {
        setChosenSeason(season)
        onSeasonChange?.(season)
      }}
      onBack={onBack}
      progressOf={progressOf}
      onPlay={play}
      favorite={{ channelId: item.id, item }}
      moreItem={item}
      onOpenSeries={onOpenSeries}
    />
  )
}
