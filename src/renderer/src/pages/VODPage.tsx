import { useCallback, useState } from 'react'
import { useStore } from '@/store'
import { CatalogPage, type CatalogPageLabels } from '@/components/catalog/CatalogPage'
import { POSTER_GRID_LAYOUT, PosterGridEmpty, renderPosterCard } from '@/components/vod/VODGrid'
import { VODDetail } from '@/components/vod/VODDetail'
import { useAddonPlayback } from '@/components/addons/useAddonPlayback'
import { useAddonDetailItem } from '@/components/addons/detail-item'
import { useCatalogPage } from '@/hooks/useCatalogPage'
import { isPlayableChannel, targetFromChannel } from '@/services/playback'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'

const TYPE_TEXT = strings.catalog.types.vod
const TONE_OF_PAGE = 'mint'

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
  hint: strings.catalog.addon.noCatalogsHint(strings.catalog.types.series.section)
}

/** Films: opening a card shows its detail; playing starts from there. */
export default function VODPage() {
  const page = useCatalogPage('vod', MESSAGES)
  const playChannel = useStore((s) => s.playChannel)
  const { openDetail, closeDetail, openPlayer } = page
  const addonPlayback = useAddonPlayback()
  const { play: playAddon } = addonPlayback
  // The record as it was clicked: a later full sync replaces the catalog
  // object, which must not reload the detail that is on screen.
  const [opened, setOpened] = useState<Channel | null>(null)
  // The catalog record, else (an add-on film opened from Favoriler before
  // its catalogue page is loaded) its favourite snapshot or the meta id alone.
  const item = useAddonDetailItem(page.detail, 'vod', opened)

  const handleOpen = useCallback(
    (film: Channel) => {
      setOpened(film)
      openDetail({
        itemId: film.id,
        sourceId: film.sourceId,
        ...(film.addonMetaId !== undefined ? { addonMetaId: film.addonMetaId } : {})
      })
    },
    [openDetail]
  )

  const handlePlay = useCallback(
    (film: Channel) => {
      // An add-on film: one of the add-ons' streams, chosen in the picker.
      const target = film.addonMetaId !== undefined ? targetFromChannel(film) : null
      if (target?.kind === 'addon') {
        playAddon({ target, channel: film, onStarted: () => openPlayer(film.id) })
        return
      }
      if (!isPlayableChannel(film)) return
      playChannel(film)
      openPlayer(film.id)
    },
    [openPlayer, playAddon, playChannel]
  )

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
        detail={item ? { label: item.name || TYPE_TEXT.section, content: <VODDetail key={item.id} item={item} onBack={closeDetail} onPlay={handlePlay} onOpen={handleOpen} /> } : null}
      />
      {addonPlayback.picker}
    </>
  )
}
