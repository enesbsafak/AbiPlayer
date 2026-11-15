import { useCallback, useMemo } from 'react'
import type { Tone } from '@/components/layout/sections'
import { CHANNEL_ROW_LAYOUT, ChannelRow } from '@/components/channels/ChannelRow'
import { POSTER_GRID_LAYOUT, renderPosterCard } from '@/components/vod/VODGrid'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import { SectionHeading } from './SectionHeading'
import { VirtualCardGrid, type CardRenderProps } from './VirtualCardGrid'

const GROUPS: ReadonlyArray<{ type: Channel['type']; tone: Tone; title: string }> = [
  { type: 'live', tone: 'coral', title: strings.catalog.groups.live },
  { type: 'vod', tone: 'mint', title: strings.catalog.groups.vod },
  { type: 'series', tone: 'sky', title: strings.catalog.groups.series }
]

interface GroupedResultsProps {
  items: readonly Channel[]
  onOpen: (item: Channel) => void
  /** The element that scrolls the groups. */
  scrollElement: HTMLElement | null
  /** Prefix for the headings' ids (two of these can be on screen at once). */
  idPrefix: string
}

/**
 * A mixed list (favourites, search results) split by kind, each part headed
 * as on the home screen: channels as rows, films and series as posters, the
 * same rows and posters as their own pages. Each part is its own keyboard
 * grid; Tab moves from one to the next. A part with nothing in it is left out.
 */
export function GroupedResults({ items, onOpen, scrollElement, idPrefix }: GroupedResultsProps) {
  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({ ...group, items: items.filter((item) => item.type === group.type) })).filter(
        (group) => group.items.length > 0
      ),
    [items]
  )
  const renderRow = useCallback(
    ({ item, onOpen: open, eagerImage, focusProps, secondaryTabIndex }: CardRenderProps<Channel>) => (
      <ChannelRow
        channel={item}
        selected={false}
        guide={null}
        now={0}
        onPlay={open}
        eagerImage={eagerImage}
        focusProps={focusProps}
        secondaryTabIndex={secondaryTabIndex}
      />
    ),
    []
  )

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => {
        const headingId = `${idPrefix}-${group.type}`
        return (
          <section key={group.type} aria-labelledby={headingId} className="flex flex-col gap-3">
            <SectionHeading id={headingId} tone={group.tone} count={strings.catalog.groups.count(group.items.length)}>
              {group.title}
            </SectionHeading>
            <VirtualCardGrid<Channel>
              items={group.items}
              layout={group.type === 'live' ? CHANNEL_ROW_LAYOUT : POSTER_GRID_LAYOUT}
              renderCard={group.type === 'live' ? renderRow : renderPosterCard}
              onOpen={onOpen}
              scrollElement={scrollElement}
              ariaLabel={group.title}
            />
          </section>
        )
      })}
    </div>
  )
}
