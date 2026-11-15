import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeftIcon } from '@/components/ui/icons'
import { LazyImage } from '@/components/ui/LazyImage'
import { SectionHeading } from '@/components/catalog/SectionHeading'
import { useElementSize } from '@/components/home/HomeRows'
import { useVisibleCatalogItems } from '@/catalog'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import { VODCard } from './VODCard'
import type { WatchShare } from './watch-share'

/*
 * The pieces the film and series detail views share, in the "Canlı renk"
 * language: a back pill, the poster whole as a card, the title, facts as
 * quiet pills, a thick progress line, and the one white primary action.
 */

/** The screen's one primary action: a white pill, ink text. */
export const DETAIL_PRIMARY =
  'flex h-[60px] items-center gap-3 rounded-full bg-white pl-7 pr-[34px] text-xl font-bold text-ink transition-colors hover:bg-surface-300 disabled:opacity-50'

export function BackPill({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex h-11 w-fit items-center gap-2 rounded-full bg-raised pl-4 pr-5 text-base font-bold text-white transition-colors hover:bg-surface-800"
    >
      <ArrowLeftIcon size={18} />
      {strings.common.back}
    </button>
  )
}

/** The poster whole, as a card: 2:3, radius 20, never cropped into a banner. */
export function DetailPoster({ src }: { src?: string }) {
  return (
    // 280 px as designed; 1.25 × that in a large window, where it stood small.
    <div className="aspect-[2/3] w-[clamp(160px,20vw,280px)] shrink-0 self-start overflow-hidden rounded-card bg-raised min-[1800px]:w-[350px]">
      <LazyImage src={src} alt="" eager className="h-full w-full" />
    </div>
  )
}

export function DetailTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-title line-clamp-3 break-words pb-[0.1em] text-[clamp(32px,3.2vw,52px)] min-[1800px]:text-[64px] leading-[1.05] tracking-[-0.03em]">
      {children}
    </h1>
  )
}

/** One fact (year, length, rating, genre) as a quiet raised pill. */
export function FactPill({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-9 items-center gap-1.5 rounded-full bg-raised px-3.5 text-[15px] font-bold text-white">
      {children}
    </span>
  )
}

const MORE = { minCard: 150, gap: 20, maxColumns: 12 }

/**
 * Other films or series from the item's category, in one row of posters the
 * size of the grid's: as many as the width holds, so a wide window gets more
 * of them rather than a bare band under the detail. Opening one shows its
 * detail in place of this one.
 */
export function MoreInCategory({ item, onOpen }: { item: Channel; onOpen: (item: Channel) => void }) {
  const type = item.type === 'series' ? 'series' : 'vod'
  const categoryItems = useVisibleCatalogItems(item.categoryId ? item.sourceId : null, type, item.categoryId)
  const [row, setRow] = useState<HTMLDivElement | null>(null)
  const { width } = useElementSize(row)
  const columns = Math.max(2, Math.min(MORE.maxColumns, Math.floor((width + MORE.gap) / (MORE.minCard + MORE.gap))))
  const others = useMemo(
    () => categoryItems.filter((other) => other.id !== item.id).slice(0, columns),
    [categoryItems, item.id, columns]
  )
  if (others.length === 0) return null
  return (
    <section aria-labelledby="detail-more" className="flex flex-col gap-3">
      <SectionHeading id="detail-more" tone={type === 'series' ? 'sky' : 'mint'}>
        {strings.catalog.detail.moreInCategory}
      </SectionHeading>
      <div
        ref={setRow}
        className="grid gap-5"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {others.map((other) => (
          <VODCard key={other.id} item={other} onPlay={onOpen} />
        ))}
      </div>
    </section>
  )
}

/** How much of it was watched: a thick bar of comfortable length and the time left. */
export function WatchLine({ share, label }: { share: WatchShare; label: string }) {
  return (
    <div className="flex max-w-[460px] items-center gap-4">
      <div role="img" aria-label={label} className="h-3 flex-1 overflow-hidden rounded-full bg-white/20">
        <div className="h-full rounded-full bg-sun" style={{ width: `${share.percent}%` }} />
      </div>
      <span className="whitespace-nowrap text-base font-bold">{strings.catalog.home.remaining(share.minutesLeft)}</span>
    </div>
  )
}
