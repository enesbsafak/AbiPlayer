import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LazyImage } from '@/components/ui/LazyImage'
import { UpdateBadge } from '@/components/layout/UpdateBadge'
import { TONE, type Tone } from '@/components/layout/sections'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import { SPATIAL_ATTRIBUTE } from './spatial-focus'

const text = strings.catalog.home
const spatial = { [SPATIAL_ATTRIBUTE]: '' }

/*
 * The home screen below the top bar: the tile block, then rows of real
 * content filling the height, and the footer. Sizes stay close to the
 * 1280 × 800 design whatever the window: a bigger window gets more rows (and,
 * wider, more columns in the block and more posters per row), never bigger
 * tiles or an empty band. Only whole rows are drawn: home never scrolls and
 * never shows a row cut in half.
 */

export const SHORT_QUERY = '(max-height: 720px)'
const POSTER_GAP = 20
/** Item width, as the classes below draw it (normal / short window). */
const ITEM_WIDTH = { normal: 132, short: 100 }

export type RowShape = 'poster' | 'logo'

/** The heading line above a row and the gap under it (normal / short window). */
const HEADING = { normal: 32 + 10, short: 32 + 8 }

/**
 * Height of a whole row: the heading line and its gap, then the picture, an
 * 8 px gap and one 20 px line of name. The classes in ROW_CLASS draw exactly this.
 */
export const ROW_HEIGHT: Record<RowShape, { normal: number; short: number }> = {
  poster: { normal: HEADING.normal + 198 + 8 + 20, short: HEADING.short + 150 + 8 + 20 },
  logo: { normal: HEADING.normal + 132 + 8 + 20, short: HEADING.short + 100 + 8 + 20 }
}

const ROW_CLASS: Record<RowShape, string> = {
  poster: 'h-[268px] short:h-[218px]',
  logo: 'h-[202px] short:h-[168px]'
}

const PICTURE_CLASS: Record<RowShape, string> = {
  poster: 'h-[198px] w-[132px] short:h-[150px] short:w-[100px]',
  logo: 'size-[132px] short:size-[100px]'
}

/**
 * The tile block: designed at 430 px, never over 1.25 × (530), never under 250
 * (the smallest window). It gives up to 50 px (to 380) for one more whole row
 * rather than leave that row's height empty.
 */
export const BLOCK = { designed: 430, min: 250, max: 530, yield: 380 }
/**
 * The gap above each row (and between the block and the first): 24 px, 20 in
 * a short window, clearly more than the 10 px between a heading and its row;
 * at most doubled to take up spare height.
 */
const GAP = { normal: 24, short: 20 }
/** The footer when no row is drawn (it otherwise sits in the last row's corner). */
const FOOTER_ALONE = 74

/** How many items fit across `width`. */
export function postersThatFit(width: number, itemWidth: number, gap = POSTER_GAP): number {
  if (width <= 0) return 0
  return Math.max(0, Math.floor((width + gap) / (itemWidth + gap)))
}

/**
 * The rows, taken in order, that fit whole into `height` (their indexes): a
 * row too tall for what is left is passed over for a shorter one further down.
 */
export function rowsThatFit(height: number, rowHeights: readonly number[], gap: number): number[] {
  let used = 0
  const fitting: number[] = []
  rowHeights.forEach((rowHeight, index) => {
    const next = used + (fitting.length > 0 ? gap : 0) + rowHeight
    if (next > height) return
    used = next
    fitting.push(index)
  })
  return fitting
}

export interface HomeLayout {
  /** Height of the tile block. */
  block: number
  /** Indexes of the rows drawn. */
  rows: number[]
  /** Gap above each row. */
  gap: number
}

/**
 * Splits the stage's height between the tile block and the rows. The block
 * takes its designed 430 px (less only when the window is too short for it
 * and one row), the rows that fit whole follow; if a slightly shorter block
 * (down to 380) makes room for one more row, it gives way. Whatever is left
 * is spent on a taller block (up to 1.25 ×) and then on evenly wider gaps (up
 * to double), so a tall window does not end in an empty band.
 */
export function layoutHome(height: number, rowHeights: readonly number[], short: boolean): HomeLayout {
  const gap = short ? GAP.short : GAP.normal
  if (height <= 0) return { block: BLOCK.designed, rows: [], gap }
  const first = rowHeights[0]
  let block =
    first === undefined
      ? Math.min(BLOCK.designed, Math.max(BLOCK.min, height - gap - FOOTER_ALONE))
      : Math.min(BLOCK.designed, Math.max(BLOCK.min, height - gap - first))
  let rows = rowsThatFit(height - block - gap, rowHeights, gap)
  const yielded = rowsThatFit(height - Math.min(block, BLOCK.yield) - gap, rowHeights, gap)
  if (yielded.length > rows.length) {
    rows = yielded
    const rowsHeight = rows.reduce((sum, index) => sum + gap + rowHeights[index]!, 0)
    block = Math.min(block, height - rowsHeight)
  }
  let used = block
  for (const index of rows) used += gap + rowHeights[index]!
  if (rows.length === 0) used += gap + FOOTER_ALONE
  let spare = Math.max(0, height - used)
  const blockExtra = Math.min(spare, BLOCK.max - block)
  spare -= blockExtra
  const gapExtra = rows.length > 0 ? Math.min(gap, Math.floor(spare / rows.length)) : 0
  return { block: block + blockExtra, rows, gap: gap + gapExtra }
}

export function useShortWindow(): boolean {
  return useMediaQuery(SHORT_QUERY)
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

/** The element's content size, followed as it changes. */
export function useElementSize(element: HTMLElement | null): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!element) return
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return size
}

export interface HomeRow {
  id: string
  title: string
  shape: RowShape
  /** The colour of the section the row belongs to: its heading's mark. */
  tone: Tone
  /** "Tümünü gör": where the row continues (`onClick` can pick a category first). */
  link?: { to: string; onClick?: () => void }
  items: readonly Channel[]
  /** Still on its way: placeholders keep the row's place. */
  loading?: boolean
  onOpen: (item: Channel) => void
}

function Row({ row, short, trailing, style }: { row: HomeRow; short: boolean; trailing?: ReactNode; style?: CSSProperties }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const { width } = useElementSize(element)
  const fit = postersThatFit(width, short ? ITEM_WIDTH.short : ITEM_WIDTH.normal)
  const headingId = `home-row-${row.id}`
  const picture = `rounded-card ${PICTURE_CLASS[row.shape]}`

  return (
    <section aria-labelledby={headingId} style={style} className={`flex min-w-0 shrink-0 flex-col gap-2.5 short:gap-2 ${ROW_CLASS[row.shape]}`}>
      <div className="flex h-8 min-w-0 items-center gap-3">
        <span aria-hidden="true" className={`size-3 shrink-0 rounded-[4px] ${TONE[row.tone].fill}`} />
        <h2 id={headingId} className="font-title min-w-0 max-w-[55%] shrink-0 truncate text-[23px] leading-[1.2] short:text-[21px]">
          {row.title}
        </h2>
        {/* The last row's heading line carries the footer, so the posters below get the full width. */}
        <div className="flex min-w-0 flex-1 justify-end">{trailing}</div>
        {row.link && (
          <Link
            to={row.link.to}
            onClick={row.link.onClick}
            className="flex h-7 shrink-0 items-center rounded-full bg-raised px-3.5 text-[13px] font-bold text-surface-400 transition-colors hover:bg-surface-800 hover:text-white"
          >
            {text.viewAll}
          </Link>
        )}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 gap-5">
        {row.items.length === 0 && row.loading ? (
          <div ref={setElement} className="flex min-w-0 flex-1 gap-5" aria-busy="true" aria-label={text.rowLoading(row.title)}>
            {Array.from({ length: fit }, (_, index) => (
              <div key={index} className={`poster-shimmer shrink-0 bg-surface-800 ${picture}`} />
            ))}
          </div>
        ) : (
          <div ref={setElement} className="flex min-w-0 flex-1 gap-5">
            {row.items.slice(0, fit).map((item) => (
              <button
                key={item.id}
                type="button"
                {...spatial}
                onClick={() => row.onOpen(item)}
                aria-label={strings.common.playItem(item.name)}
                title={item.name}
                className="group flex w-[132px] shrink-0 flex-col gap-2 rounded-card text-left short:w-[100px]"
              >
                <LazyImage
                  src={row.shape === 'logo' ? item.logo || item.coverUrl : item.coverUrl || item.logo}
                  alt=""
                  fit={row.shape === 'logo' ? 'contain' : 'cover'}
                  className={`bg-raised ${picture}`}
                />
                <span className="truncate text-[15px] font-bold leading-5 text-white transition-colors group-hover:text-mint">
                  {item.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export type SourceTone = 'ok' | 'busy' | 'failed'

const SOURCE_DOT: Record<SourceTone, string> = { ok: 'bg-mint', busy: 'bg-sun', failed: 'bg-coral' }

function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="flex h-7 items-center rounded-[10px] border-b-[3px] border-deep bg-raised px-2.5 font-sans text-[13px] font-bold text-white">
      {children}
    </kbd>
  )
}

/**
 * The version, where the source stands, and the keys that work here. Inline,
 * it is one quiet line in the last row's heading (the posters keep the full
 * width); the parts that do not fit a narrow window give way, the source
 * status last. Alone (no rows: welcome, loading, error), it is the bottom
 * right corner, as designed.
 */
function HomeFooter({ source, inline = false }: { source: { tone: SourceTone; text: string } | null; inline?: boolean }) {
  const keys = text.keys
  if (inline) {
    return (
      <div className="flex min-w-0 items-center justify-end gap-4 text-[13px] text-surface-500">
        {source && (
          <p role="status" className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${SOURCE_DOT[source.tone]}`} />
            <span className="truncate">{source.text}</span>
          </p>
        )}
        <div className="shrink-0 max-xl:hidden">
          <UpdateBadge />
        </div>
        <div role="group" aria-label={keys.label} className="flex shrink-0 items-center gap-2 whitespace-nowrap max-lg:hidden">
          <KeyCap>{keys.arrows}</KeyCap>
          {keys.arrowsAction}
          <span className="ml-1 flex items-center gap-2">
            <KeyCap>{keys.enter}</KeyCap>
            {keys.enterAction}
          </span>
          <span className="ml-1 flex items-center gap-2 max-xl:hidden">
            <KeyCap>{strings.shell.header.searchShortcut}</KeyCap>
            {keys.searchAction}
          </span>
        </div>
      </div>
    )
  }
  return (
    <div className="ml-auto flex shrink-0 flex-col items-end justify-end gap-3.5 self-end text-sm text-surface-500">
      <div className="flex items-center gap-3">
        <UpdateBadge />
        {source && (
          <p role="status" className="flex items-center gap-2 whitespace-nowrap">
            <span aria-hidden="true" className={`size-2.5 rounded-full ${SOURCE_DOT[source.tone]}`} />
            {source.text}
          </p>
        )}
      </div>
      <div role="group" aria-label={keys.label} className="flex flex-wrap items-center justify-end gap-2 whitespace-nowrap">
        <KeyCap>{keys.arrows}</KeyCap>
        {keys.arrowsAction}
        <span className="ml-1.5 flex items-center gap-2">
          <KeyCap>{keys.enter}</KeyCap>
          {keys.enterAction}
        </span>
        <span className="ml-1.5 flex items-center gap-2 max-lg:hidden">
          <KeyCap>{strings.shell.header.searchShortcut}</KeyCap>
          {keys.searchAction}
        </span>
      </div>
    </div>
  )
}

interface HomeStageProps {
  /** The tile block's areas: the large tile, the destination tiles, and the panel wide windows add. */
  block: ReactNode
  /** The candidate rows, in order; the caller leaves out rows with nothing in them. */
  rows: readonly HomeRow[]
  source: { tone: SourceTone; text: string } | null
  /** The block has the channel panel (wide windows, and only when there are channels to list). */
  withPanel: boolean
}

/**
 * Lays out the tile block and the rows in the height left under the bar
 * (`layoutHome`). The block is a grid whose tracks have maximum sizes: the
 * large tile and the 2 × 2 tiles grow to at most 1.25 × their designed width,
 * and from 1600 px a third area takes the rest of the width. Without it (no
 * channels to list) the block is centred rather than leaving a hole on the right.
 */
export function HomeStage({ block, rows, source, withPanel }: HomeStageProps) {
  const short = useShortWindow()
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const { height } = useElementSize(element)
  const size = short ? 'short' : 'normal'
  const layout = layoutHome(
    height,
    rows.map((row) => ROW_HEIGHT[row.shape][size]),
    short
  )
  const shown = layout.rows.map((index) => rows[index]!)
  const footer = <HomeFooter source={source} />
  const inlineFooter = <HomeFooter source={source} inline />

  return (
    <div ref={setElement} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        style={{ height: layout.block }}
        className={`grid shrink-0 grid-cols-[minmax(0,756px)_minmax(0,752px)] justify-center gap-5 short:gap-4 ${
          withPanel ? 'min-[1600px]:grid-cols-[minmax(0,756px)_minmax(0,752px)_minmax(320px,1fr)]' : ''
        }`}
      >
        {block}
      </div>
      {shown.map((row, index) => (
        <Row
          key={row.id}
          row={row}
          short={short}
          style={{ marginTop: layout.gap }}
          trailing={index === shown.length - 1 ? inlineFooter : undefined}
        />
      ))}
      {shown.length === 0 && <div className="mt-auto flex justify-end">{footer}</div>}
    </div>
  )
}
