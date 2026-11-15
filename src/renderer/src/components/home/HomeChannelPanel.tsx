import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LazyImage } from '@/components/ui/LazyImage'
import { ArrowRightIcon, StarIcon } from '@/components/ui/icons'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import { SPATIAL_ATTRIBUTE } from './spatial-focus'
import { useElementSize } from './HomeRows'

const text = strings.catalog.home.channels
const spatial = { [SPATIAL_ATTRIBUTE]: '' }

/** An entry's minimum width and its height, and the gap between entries (as the classes draw them). */
const ENTRY = { minWidth: 260, height: 64, gap: 12 }

/** Columns and rows of entries that fit whole into a `width` × `height` area. */
export function entryGrid(width: number, height: number): { columns: number; rows: number } {
  if (width <= 0 || height <= 0) return { columns: 0, rows: 0 }
  return {
    columns: Math.max(1, Math.floor((width + ENTRY.gap) / (ENTRY.minWidth + ENTRY.gap))),
    rows: Math.max(0, Math.floor((height + ENTRY.gap) / (ENTRY.height + ENTRY.gap)))
  }
}

export interface PanelChannel {
  channel: Channel
  favorite: boolean
  /** What is on now, when the guide is in memory. */
  now: string | null
}

interface HomeChannelPanelProps {
  /** Favourite channels of the source first, then the rest of its list. */
  channels: readonly PanelChannel[]
  hasFavorites: boolean
  onPlay: (channel: Channel) => void
}

/**
 * The third area of the tile block in a wide window: live channels as a grid
 * of entries, favourites first (marked with a star), with what is on now when
 * the guide is known. As many columns and rows as fit; a fresh profile, which
 * has no favourites, still gets the source's channels and a line on how to
 * pin one here.
 */
export function HomeChannelPanel({ channels, hasFavorites, onPlay }: HomeChannelPanelProps) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const { width, height } = useElementSize(element)
  const { columns, rows } = entryGrid(width, height)
  const shown = channels.slice(0, columns * rows)

  return (
    <section
      aria-labelledby="home-channels"
      className="hidden min-h-0 min-w-0 flex-col gap-4 rounded-tile bg-raised pb-6 pl-6 pr-5 pt-[22px] short:gap-3 short:pb-4 short:pt-4 min-[1600px]:flex"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-channels" className="font-title truncate text-[30px] leading-[1.15]">
          {text.title}
        </h2>
        <Link
          to="/live"
          {...spatial}
          aria-label={text.openLive}
          title={text.openLive}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-coral text-ink"
        >
          <ArrowRightIcon size={20} />
        </Link>
      </div>
      {!hasFavorites && <p className="-mt-2 text-sm text-surface-500">{text.favoriteHint}</p>}
      <div
        ref={setElement}
        className="grid min-h-0 flex-1 content-start gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
          // A full panel shares out the height under its last whole row, so
          // it does not end in a strip of nothing.
          gridTemplateRows: shown.length === columns * rows && rows > 0 ? `repeat(${rows}, minmax(${ENTRY.height}px, 1fr))` : undefined
        }}
      >
        {shown.map(({ channel, favorite, now }) => (
          <button
            key={channel.id}
            type="button"
            {...spatial}
            onClick={() => onPlay(channel)}
            aria-label={strings.common.playItem(channel.name)}
            className="flex h-full min-h-16 min-w-0 items-center gap-3 rounded-card bg-ground px-2.5 text-left transition-colors hover:bg-surface-800"
          >
            <LazyImage
              src={channel.logo}
              alt=""
              fit="contain"
              className="size-11 shrink-0 rounded-[12px] bg-raised"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-bold leading-5 text-white">{channel.name}</span>
              {now && <span className="truncate text-[13px] leading-[18px] text-surface-500">{text.now(now)}</span>}
            </span>
            {favorite && <StarIcon size={16} className="mr-1 shrink-0 fill-sun text-sun" />}
          </button>
        ))}
      </div>
    </section>
  )
}
