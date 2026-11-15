import { useCallback, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { CatalogPage, type CatalogPageLabels } from '@/components/catalog/CatalogPage'
import type { CardRenderProps } from '@/components/catalog/VirtualCardGrid'
import { ChannelGridEmpty } from '@/components/channels/ChannelGrid'
import { CHANNEL_ROW_LAYOUT, ChannelRow } from '@/components/channels/ChannelRow'
import { LiveChannelPanel } from '@/components/channels/LiveChannelPanel'
import { guideFor, useSourceGuide } from '@/components/channels/live-guide'
import { useCatalogPage } from '@/hooks/useCatalogPage'
import { useMinuteClock } from '@/hooks/useMinuteClock'
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

/**
 * Live TV: channels as rows, the channel in focus filled with coral and shown
 * in the panel beside the list. Looking is the arrow keys and the pointer
 * (they move the focus and the panel follows); playing is one click or Enter
 * on a row, or "Bu kanalı izle" in the panel. So "look first" never costs a
 * click and "just play" never costs two.
 */
export default function LiveTVPage() {
  const page = useCatalogPage('live', MESSAGES)
  const playChannel = useStore((s) => s.playChannel)
  const { openPlayer, items } = page
  const guide = useSourceGuide(page.sourceId)
  const now = useMinuteClock()
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // The first channel until the viewer moves; a channel no longer listed
  // (another category, a search) gives way to the first one too.
  const focused = useMemo(
    () => (focusedId ? items.find((item) => item.id === focusedId) : undefined) ?? items[0] ?? null,
    [items, focusedId]
  )

  const handlePlay = useCallback(
    (channel: Channel) => {
      if (!isPlayableChannel(channel)) return
      playChannel(channel)
      openPlayer(channel.id)
    },
    [openPlayer, playChannel]
  )
  const activate = useCallback((channel: Channel) => setFocusedId(channel.id), [])

  const focusedRowId = focused?.id ?? null
  const renderRow = useCallback(
    ({ item, onOpen, eagerImage, focusProps, secondaryTabIndex }: CardRenderProps<Channel>) => (
      <ChannelRow
        channel={item}
        selected={item.id === focusedRowId}
        guide={guideFor(guide, item, now)}
        now={now}
        onPlay={onOpen}
        onActivate={activate}
        eagerImage={eagerImage}
        focusProps={focusProps}
        secondaryTabIndex={secondaryTabIndex}
      />
    ),
    [focusedRowId, guide, now, activate]
  )

  return (
    <CatalogPage
      page={page}
      labels={LABELS}
      tone="coral"
      layout={CHANNEL_ROW_LAYOUT}
      renderCard={renderRow}
      onOpen={handlePlay}
      empty={<ChannelGridEmpty />}
      side={focused ? <LiveChannelPanel channel={focused} guide={guideFor(guide, focused, now)} now={now} onPlay={handlePlay} /> : undefined}
    />
  )
}
