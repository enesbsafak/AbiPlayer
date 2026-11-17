import { useCallback, useState } from 'react'
import { useStore } from '@/store'
import { CatalogPage, type CatalogPageLabels } from '@/components/catalog/CatalogPage'
import { POSTER_GRID_LAYOUT, PosterGridEmpty, renderPosterCard } from '@/components/vod/VODGrid'
import { SeriesDetail } from '@/components/series/SeriesDetail'
import { AddonSeriesDetail, type AddonEpisodeRequest } from '@/components/series/AddonSeriesDetail'
import { useAddonPlayback } from '@/components/addons/useAddonPlayback'
import { useAddonDetailItem } from '@/components/addons/detail-item'
import { useCatalogPage } from '@/hooks/useCatalogPage'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import type { EpisodePlaybackRequest } from '@/types/player'

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

const NO_CATALOGS = {
  title: strings.catalog.addon.noCatalogs(TYPE_TEXT.noun),
  hint: strings.catalog.addon.noCatalogsHint(strings.catalog.types.vod.section)
}

/** Series: opening a card shows its seasons and episodes; an episode plays. */
export default function SeriesPage() {
  const page = useCatalogPage('series', MESSAGES)
  const playEpisode = useStore((s) => s.playEpisode)
  const { detail, openDetail, closeDetail, updateDetail, openPlayer } = page
  const addonPlayback = useAddonPlayback()
  const { play: playAddon } = addonPlayback
  // The record as it was clicked: a search result of the source is in no
  // category of the catalog, and its card already knows its name and poster.
  const [opened, setOpened] = useState<Channel | null>(null)
  const addonItem = useAddonDetailItem(detail?.addonMetaId !== undefined ? detail : null, 'series', opened)

  const handleOpen = useCallback(
    (series: Channel) => {
      if (series.addonMetaId !== undefined) {
        setOpened(series)
        openDetail({ itemId: series.id, sourceId: series.sourceId, addonMetaId: series.addonMetaId })
        return
      }
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

  // An add-on episode: one of the add-ons' streams, chosen in the picker (or
  // the remembered add-on and release, for the next episode).
  const handlePlayAddonEpisode = useCallback(
    ({ target, channel, season }: AddonEpisodeRequest) =>
      playAddon({ target, channel, onStarted: () => openPlayer(detail?.itemId ?? null, { season }) }),
    [detail?.itemId, openPlayer, playAddon]
  )

  const seriesId = detail?.seriesId
  let content = null
  if (detail && detail.addonMetaId !== undefined && addonItem) {
    content = (
      <AddonSeriesDetail
        key={`${detail.sourceId}\n${detail.addonMetaId}`}
        item={addonItem}
        metaId={detail.addonMetaId}
        initialSeasonNumber={detail.season}
        onBack={closeDetail}
        onSeasonChange={handleSeasonChange}
        onPlayEpisode={handlePlayAddonEpisode}
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
    <>
      <CatalogPage
        page={page}
        labels={LABELS}
        tone={TONE_OF_PAGE}
        layout={POSTER_GRID_LAYOUT}
        renderCard={renderPosterCard}
        onOpen={handleOpen}
        empty={<PosterGridEmpty />}
        noCategories={NO_CATALOGS}
        detail={content ? { label: strings.catalog.detail.seriesLabel, content } : null}
      />
      {addonPlayback.picker}
    </>
  )
}
