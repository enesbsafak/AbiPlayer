import { useCallback } from 'react'
import { useStore } from '@/store'
import { CatalogPage, type CatalogPageLabels } from '@/components/catalog/CatalogPage'
import { POSTER_GRID_LAYOUT, PosterGridEmpty, renderPosterCard } from '@/components/vod/VODGrid'
import { SeriesDetail } from '@/components/series/SeriesDetail'
import { M3uSeriesDetail } from '@/components/series/M3uSeriesDetail'
import { useCatalogPage } from '@/hooks/useCatalogPage'
import { isM3uSeriesItem } from '@/services/m3u-series'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import type { EpisodePlaybackRequest, QueuedEpisode } from '@/types/player'

const TYPE_TEXT = strings.catalog.types.series
const TONE_OF_PAGE = 'sky'

const LABELS: CatalogPageLabels = {
  all: TYPE_TEXT.all,
  noun: TYPE_TEXT.noun,
  grid: TYPE_TEXT.plural,
  loading: TYPE_TEXT.loading,
  search: TYPE_TEXT.search,
  searchPlaceholder: TYPE_TEXT.searchPlaceholder
}

const MESSAGES = {
  previewLoading: TYPE_TEXT.previewLoading,
  loadFailed: TYPE_TEXT.loadFailed
}

/** Series: opening a card shows its seasons and episodes; an episode plays. */
export default function SeriesPage() {
  const page = useCatalogPage('series', MESSAGES)
  const playEpisode = useStore((s) => s.playEpisode)
  const playQueued = useStore((s) => s.playQueued)
  const { detail, openDetail, closeDetail, updateDetail, openPlayer } = page

  const handleOpen = useCallback(
    (series: Channel) => {
      // A series gathered from an M3U list has no provider id: its item is the series.
      if (isM3uSeriesItem(series)) {
        openDetail({ itemId: series.id, sourceId: series.sourceId, m3uSeries: true })
        return
      }
      if (typeof series.seriesId !== 'number') return
      openDetail({ itemId: series.id, sourceId: series.sourceId, seriesId: series.seriesId })
    },
    [openDetail]
  )

  const handleSeasonChange = useCallback((season: number) => updateDetail({ season }), [updateDetail])

  const handlePlayEpisode = useCallback(
    (episode: EpisodePlaybackRequest, queue: QueuedEpisode[]) => {
      // A real episode target: history and resume are keyed by the episode's
      // own id and source, not by a throwaway channel id or its URL. The
      // series' episodes go along: what "next" means in the player.
      playEpisode(episode, queue)
      if (!useStore.getState().currentPlayback) return
      openPlayer(detail?.itemId ?? null, { season: episode.season })
    },
    [detail?.itemId, openPlayer, playEpisode]
  )

  const handlePlayM3uEpisode = useCallback(
    (episode: QueuedEpisode, queue: QueuedEpisode[], season: number) => {
      playQueued(episode, queue)
      if (!useStore.getState().currentPlayback) return
      openPlayer(detail?.itemId ?? null, { season })
    },
    [detail?.itemId, openPlayer, playQueued]
  )

  const seriesId = detail?.seriesId
  let content = null
  if (detail?.m3uSeries) {
    content = (
      <M3uSeriesDetail
        key={detail.itemId}
        itemId={detail.itemId}
        initialSeasonNumber={detail.season}
        onBack={closeDetail}
        onSeasonChange={handleSeasonChange}
        onPlayEpisode={handlePlayM3uEpisode}
        onOpenSeries={handleOpen}
      />
    )
  } else if (detail && seriesId !== undefined) {
    content = (
      <SeriesDetail
        key={seriesId}
        seriesId={seriesId}
        sourceId={detail.sourceId}
        initialSeasonNumber={detail.season}
        onBack={closeDetail}
        onSeasonChange={handleSeasonChange}
        onPlayEpisode={handlePlayEpisode}
        onOpenSeries={handleOpen}
      />
    )
  }

  return (
    <CatalogPage
      page={page}
      labels={LABELS}
      tone={TONE_OF_PAGE}
      layout={POSTER_GRID_LAYOUT}
      renderCard={renderPosterCard}
      onOpen={handleOpen}
      empty={<PosterGridEmpty />}
      detail={content ? { label: strings.catalog.detail.seriesLabel, content } : null}
    />
  )
}
