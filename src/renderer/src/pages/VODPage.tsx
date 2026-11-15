import { useCallback, useState } from 'react'
import { useStore } from '@/store'
import { CatalogPage, type CatalogPageLabels } from '@/components/catalog/CatalogPage'
import { POSTER_GRID_LAYOUT, PosterGridEmpty, renderPosterCard } from '@/components/vod/VODGrid'
import { VODDetail } from '@/components/vod/VODDetail'
import { useCatalogPage } from '@/hooks/useCatalogPage'
import { isPlayableChannel } from '@/services/playback'
import { useCatalogItem } from '@/catalog'
import type { Channel } from '@/types/playlist'

const LABELS: CatalogPageLabels = {
  all: 'Tüm Filmler',
  noun: 'film',
  grid: 'Filmler',
  loading: 'Film içerikleri yükleniyor...',
  search: 'Film ara'
}

const MESSAGES = {
  previewLoading: 'Filmler hızlı ön izleme listesiyle açılıyor...',
  loadFailed: 'Film içerikleri yüklenemedi'
}

/** Films: opening a card shows its detail; playing starts from there. */
export default function VODPage() {
  const page = useCatalogPage('vod', MESSAGES)
  const playChannel = useStore((s) => s.playChannel)
  const { openDetail, closeDetail, openPlayer } = page
  // The record as it was clicked: a later full sync replaces the catalog
  // object, which must not reload the detail that is on screen.
  const [opened, setOpened] = useState<Channel | null>(null)
  const detailId = page.detail?.itemId ?? null
  const catalogItem = useCatalogItem(detailId)
  const item = detailId ? (opened?.id === detailId ? opened : (catalogItem ?? null)) : null

  const handleOpen = useCallback(
    (film: Channel) => {
      setOpened(film)
      openDetail({ itemId: film.id, sourceId: film.sourceId })
    },
    [openDetail]
  )

  const handlePlay = useCallback(
    (film: Channel) => {
      if (!isPlayableChannel(film)) return
      playChannel(film)
      openPlayer(film.id)
    },
    [openPlayer, playChannel]
  )

  return (
    <CatalogPage
      page={page}
      labels={LABELS}
      layout={POSTER_GRID_LAYOUT}
      renderCard={renderPosterCard}
      onOpen={handleOpen}
      empty={<PosterGridEmpty />}
      detail={item ? { label: item.name, content: <VODDetail item={item} onBack={closeDetail} onPlay={handlePlay} /> } : null}
    />
  )
}
