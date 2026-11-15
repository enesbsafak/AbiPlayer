import { useCallback } from 'react'
import { useStore } from '@/store'
import { CatalogPage, type CatalogPageLabels } from '@/components/catalog/CatalogPage'
import { CHANNEL_GRID_LAYOUT, ChannelGridEmpty, renderChannelCard } from '@/components/channels/ChannelGrid'
import { useCatalogPage } from '@/hooks/useCatalogPage'
import { isPlayableChannel } from '@/services/playback'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'

const TYPE_TEXT = strings.catalog.types.live

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

/** Live TV: opening a card plays it. */
export default function LiveTVPage() {
  const page = useCatalogPage('live', MESSAGES)
  const playChannel = useStore((s) => s.playChannel)
  const { openPlayer } = page

  const handlePlay = useCallback(
    (channel: Channel) => {
      if (!isPlayableChannel(channel)) return
      playChannel(channel)
      openPlayer(channel.id)
    },
    [openPlayer, playChannel]
  )

  return (
    <CatalogPage
      page={page}
      labels={LABELS}
      layout={CHANNEL_GRID_LAYOUT}
      renderCard={renderChannelCard}
      onOpen={handlePlay}
      empty={<ChannelGridEmpty />}
    />
  )
}
