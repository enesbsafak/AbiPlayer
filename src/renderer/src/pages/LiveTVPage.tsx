import { useCallback } from 'react'
import { useStore } from '@/store'
import { CatalogPage, type CatalogPageLabels } from '@/components/catalog/CatalogPage'
import { CHANNEL_GRID_LAYOUT, ChannelGridEmpty, renderChannelCard } from '@/components/channels/ChannelGrid'
import { useCatalogPage } from '@/hooks/useCatalogPage'
import { isPlayableChannel } from '@/services/playback'
import type { Channel } from '@/types/playlist'

const LABELS: CatalogPageLabels = {
  all: 'Tüm Kanallar',
  noun: 'kanal',
  grid: 'Kanallar',
  loading: 'Kanallar yükleniyor...',
  search: 'Kanal ara'
}

const MESSAGES = {
  previewLoading: 'Kanallar hızlı ön izleme listesiyle açılıyor...',
  loadFailed: 'Kanallar yüklenemedi'
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
