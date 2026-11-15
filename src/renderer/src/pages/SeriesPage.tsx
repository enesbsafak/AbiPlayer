import { useCallback } from 'react'
import { useStore } from '@/store'
import { CatalogPage, type CatalogPageLabels } from '@/components/catalog/CatalogPage'
import { POSTER_GRID_LAYOUT, PosterGridEmpty, renderPosterCard } from '@/components/vod/VODGrid'
import { SeriesDetail } from '@/components/series/SeriesDetail'
import { useCatalogPage } from '@/hooks/useCatalogPage'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import type { EpisodePlaybackRequest } from '@/types/player'

const TYPE_TEXT = strings.catalog.types.series

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
  const { detail, openDetail, closeDetail, updateDetail, openPlayer } = page

  const handleOpen = useCallback(
    (series: Channel) => {
      if (typeof series.seriesId !== 'number') return
      openDetail({ itemId: series.id, sourceId: series.sourceId, seriesId: series.seriesId })
    },
    [openDetail]
  )

  const handleSeasonChange = useCallback((season: number) => updateDetail({ season }), [updateDetail])

  const handlePlayEpisode = useCallback(
    (episode: EpisodePlaybackRequest) => {
      // A real episode target: history and resume are keyed by the episode's
      // own id and source, not by a throwaway channel id or its URL.
      playEpisode(episode)
      if (!useStore.getState().currentPlayback) return
      openPlayer(detail?.itemId ?? null, { season: episode.season })
    },
    [detail?.itemId, openPlayer, playEpisode]
  )

  const seriesId = detail?.seriesId
  return (
    <CatalogPage
      page={page}
      labels={LABELS}
      layout={POSTER_GRID_LAYOUT}
      renderCard={renderPosterCard}
      onOpen={handleOpen}
      empty={<PosterGridEmpty />}
      detail={
        detail && seriesId !== undefined
          ? {
              label: strings.catalog.detail.seriesLabel,
              content: (
                <SeriesDetail
                  seriesId={seriesId}
                  sourceId={detail.sourceId}
                  initialSeasonNumber={detail.season}
                  onBack={closeDetail}
                  onSeasonChange={handleSeasonChange}
                  onPlayEpisode={handlePlayEpisode}
                />
              )
            }
          : null
      }
    />
  )
}
