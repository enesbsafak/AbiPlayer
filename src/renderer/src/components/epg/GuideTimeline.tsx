import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LazyImage } from '@/components/ui/LazyImage'
import { StarIcon } from '@/components/ui/icons'
import { formatWeekday } from '@/hooks/useMinuteClock'
import type { CatalogItem } from '@/catalog/types'
import type { EPGProgram } from '@/types/epg'
import { strings } from '@/strings'
import {
  HALF_HOUR_MS,
  HEADER_HEIGHT,
  HOUR_MS,
  MINUTE_MS,
  PX_PER_MINUTE,
  ROW_HEIGHT,
  ROW_PITCH,
  calendarDayOffset,
  channelColumnWidth,
  defaultViewStart,
  drawWindow,
  floorTo,
  indexAtTime,
  neighbourIndex,
  programTiming,
  revealScrollLeft,
  revealScrollTop,
  segmentsInWindow,
  timeToX,
  timelineRange,
  xToTime,
  type GuideFocus,
  type GuideRow
} from './guide-model'

const text = strings.epg

/** Space between blocks, split on both sides of each. */
const BLOCK_INSET = 3
/** Room the text of a block keeps from the channel column while it sticks to the left edge. */
const TEXT_INSET = 14

export interface GuideTimelineHandle {
  /** Scrolls back to the time around now and focuses what is on now on the focused channel. */
  jumpToNow(): void
}

interface GuideTimelineProps {
  rows: readonly GuideRow[]
  focus: GuideFocus | null
  now: number
  formatTime: (ts: number) => string
  favoriteIds: ReadonlySet<string>
  onFocusChange: (rowIndex: number, start: number) => void
  onPlay: (rowIndex: number) => void
  onToggleFavorite: (rowIndex: number) => void
}

interface Range {
  start: number
  end: number
}

interface TimeWindow {
  from: number
  to: number
}

function dayLabel(ts: number, now: number): string {
  switch (calendarDayOffset(ts, now)) {
    case 0:
      return text.today
    case 1:
      return text.tomorrow
    case -1:
      return text.yesterday
    default:
      return formatWeekday(ts)
  }
}

function ChannelLogo({ channel }: { channel: CatalogItem }) {
  if (!channel.logo) {
    return (
      <span aria-hidden="true" className="font-title flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-lg text-surface-500">
        {channel.name.trim().charAt(0).toLocaleUpperCase(strings.common.locale)}
      </span>
    )
  }
  return <LazyImage src={channel.logo} alt="" fit="contain" className="size-9 shrink-0 rounded-[10px] bg-raised" />
}

interface ProgramBlockProps {
  rowIndex: number
  channelName: string
  program: EPGProgram
  left: number
  width: number
  stickyLeft: number
  focused: boolean
  now: number
  formatTime: (ts: number) => string
  onPick: (rowIndex: number, start: number) => void
  onPlay: (rowIndex: number) => void
}

function ProgramBlock({ rowIndex, channelName, program, left, width, stickyLeft, focused, now, formatTime, onPick, onPlay }: ProgramBlockProps) {
  const timing = programTiming(program, now)
  const time = text.timeRange(formatTime(program.start), formatTime(program.end))
  const narrow = width < 72
  const tone = focused ? 'bg-sun text-ink' : 'bg-raised text-white hover:bg-surface-800'
  return (
    <button
      type="button"
      data-epg-focused={focused ? 'true' : undefined}
      tabIndex={focused ? 0 : -1}
      aria-pressed={focused}
      aria-label={text.programLabel(channelName, program.title, time, timing === 'live')}
      title={`${program.title}\n${time}`}
      onClick={() => onPick(rowIndex, program.start)}
      onDoubleClick={() => onPlay(rowIndex)}
      className={`absolute flex flex-col justify-center overflow-clip rounded-[14px] text-left transition-colors ${narrow ? 'px-2' : 'px-3.5'} ${tone}`}
      style={{ left, width, top: BLOCK_INSET, height: ROW_HEIGHT }}
    >
      {width >= 28 ? (
        // Sticks to the left edge of the view, so a programme that began
        // before it still shows its title.
        <span className="sticky flex w-fit max-w-full flex-col" style={{ left: stickyLeft }}>
          <span className={`truncate text-base font-bold leading-5 ${!focused && timing === 'ended' ? 'text-surface-400' : ''}`}>
            {program.title}
          </span>
          <span className={`truncate text-sm leading-5 ${focused ? 'font-medium' : 'text-surface-500'}`}>{time}</span>
        </span>
      ) : null}
      {timing === 'live' && <span className="sr-only">{text.onNow}</span>}
    </button>
  )
}

interface GuideRowViewProps {
  row: GuideRow
  rowIndex: number
  top: number
  contentWidth: number
  column: number
  drawn: TimeWindow
  range: Range
  focusedIndex: number
  favorite: boolean
  now: number
  formatTime: (ts: number) => string
  onPick: (rowIndex: number, start: number) => void
  onPlay: (rowIndex: number) => void
}

const GuideRowView = memo(function GuideRowView({
  row,
  rowIndex,
  top,
  contentWidth,
  column,
  drawn,
  range,
  focusedIndex,
  favorite,
  now,
  formatTime,
  onPick,
  onPlay
}: GuideRowViewProps) {
  const { channel, programs } = row
  const segments = useMemo(() => segmentsInWindow(programs, drawn, range), [programs, drawn, range])
  const place = (start: number, end: number) => {
    const left = timeToX(Math.max(start, range.start), range.start)
    const right = timeToX(Math.min(end, range.end), range.start)
    return { left: column + left + BLOCK_INSET, width: Math.max(2, right - left - 2 * BLOCK_INSET) }
  }
  const stickyLeft = column + TEXT_INSET

  return (
    // No transform: the rows must not form stacking contexts, or the now line
    // would draw over the sticky channel column.
    <div role="listitem" aria-label={channel.name} className="absolute left-0" style={{ top, height: ROW_PITCH, width: contentWidth }}>
      <div className="sticky left-0 z-[3] flex h-full min-w-0 items-center gap-3 bg-ground pr-3" style={{ width: column }}>
        <ChannelLogo channel={channel} />
        <span className="min-w-0 truncate text-base font-bold" title={channel.name}>
          {channel.name}
        </span>
        {favorite && <StarIcon size={16} role="img" aria-hidden={false} aria-label={text.favorite} className="shrink-0 fill-sun text-sun" />}
      </div>
      {segments.map((segment) => {
        if (segment.kind === 'gap') {
          const { left, width } = place(segment.start, segment.end)
          return (
            <div
              key={`gap-${segment.start}`}
              className="absolute flex items-center overflow-clip rounded-[14px] bg-deep px-3.5 text-sm text-surface-500"
              style={{ left, width, top: BLOCK_INSET, height: ROW_HEIGHT }}
            >
              <span className="sticky truncate" style={{ left: stickyLeft }}>
                {text.noGuideData}
              </span>
            </div>
          )
        }
        const { left, width } = place(segment.program.start, segment.program.end)
        return (
          <ProgramBlock
            key={`${segment.program.start}-${segment.index}`}
            rowIndex={rowIndex}
            channelName={channel.name}
            program={segment.program}
            left={left}
            width={width}
            stickyLeft={stickyLeft}
            focused={segment.index === focusedIndex}
            now={now}
            formatTime={formatTime}
            onPick={onPick}
            onPlay={onPlay}
          />
        )
      })}
    </div>
  )
})

/**
 * The timeline: a sticky time header, a sticky channel column and the
 * programme blocks, in one scroller that moves both ways. Rows are
 * virtualised; within a row only the programmes of the drawn time window
 * (the visible time plus an hour each side, snapped to half hours) exist.
 */
export const GuideTimeline = forwardRef<GuideTimelineHandle, GuideTimelineProps>(function GuideTimeline(
  { rows, focus, now, formatTime, favoriteIds, onFocusChange, onPlay, onToggleFavorite },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const column = channelColumnWidth(width)
  const viewWidth = Math.max(0, width - column)

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The range only moves with the half hour (and the guide), so the blocks
  // keep their places while the clock ticks.
  const nowSlot = floorTo(now, HALF_HOUR_MS)
  const minSpan = Math.ceil((viewWidth / PX_PER_MINUTE) * MINUTE_MS / HOUR_MS) * HOUR_MS + HOUR_MS
  const range = useMemo(() => timelineRange(rows, nowSlot, minSpan), [rows, nowSlot, minSpan])
  const contentWidth = column + timeToX(range.end, range.start)

  const [drawn, setDrawn] = useState<TimeWindow>(() => drawWindow(defaultViewStart(nowSlot), defaultViewStart(nowSlot) + 3 * HOUR_MS))
  const geometry = useRef({ column, range })
  useLayoutEffect(() => {
    geometry.current = { column, range }
  }, [column, range])

  const syncWindow = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const { column: currentColumn, range: currentRange } = geometry.current
    const start = xToTime(element.scrollLeft, currentRange.start)
    const end = xToTime(element.scrollLeft + Math.max(0, element.clientWidth - currentColumn), currentRange.start)
    const next = drawWindow(start, end)
    setDrawn((previous) => (previous.from === next.from && previous.to === next.to ? previous : next))
  }, [])

  // Open around now; when the range start moves (a new half hour, a new
  // guide), keep the same time at the left edge.
  const hasRows = rows.length > 0
  const positionedAt = useRef<number | null>(null)
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || !hasRows || width === 0) return
    const previous = positionedAt.current
    if (previous === null) element.scrollLeft = timeToX(defaultViewStart(Date.now()), range.start)
    else if (previous !== range.start) element.scrollLeft += timeToX(previous, range.start)
    positionedAt.current = range.start
    syncWindow()
  }, [hasRows, range.start, width, syncWindow])

  const scrollFrame = useRef(0)
  const handleScroll = useCallback(() => {
    if (scrollFrame.current) return
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0
      syncWindow()
    })
  }, [syncWindow])
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), [])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_PITCH,
    overscan: 6,
    paddingStart: HEADER_HEIGHT
  })
  const virtualRows = virtualizer.getVirtualItems()
  const totalHeight = virtualizer.getTotalSize()

  /** Scrolls a programme into view, both ways. */
  const reveal = useCallback(
    (rowIndex: number, program: EPGProgram) => {
      const element = scrollRef.current
      if (!element) return
      const top = revealScrollTop(rowIndex, element.scrollTop, element.clientHeight)
      if (top !== null) element.scrollTop = top
      const left = revealScrollLeft(
        timeToX(Math.max(program.start, range.start), range.start),
        timeToX(Math.min(program.end, range.end), range.start),
        element.scrollLeft,
        Math.max(0, element.clientWidth - column)
      )
      if (left !== null) element.scrollLeft = left
      syncWindow()
    },
    [column, range, syncWindow]
  )

  // Keyboard moves put the focus on the new block once it is drawn (a far
  // move draws it a frame or two later, after the virtualiser scrolls).
  const pendingFocus = useRef(false)
  useEffect(() => {
    if (!pendingFocus.current) return
    let frame = 0
    let tries = 0
    const attempt = () => {
      const block = scrollRef.current?.querySelector<HTMLElement>('[data-epg-focused="true"]')
      if (block) {
        pendingFocus.current = false
        block.focus({ preventScroll: true })
      } else if (++tries < 8) {
        frame = requestAnimationFrame(attempt)
      } else {
        pendingFocus.current = false
      }
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  })

  const moveTo = useCallback(
    (rowIndex: number, index: number) => {
      const program = rows[rowIndex]?.programs[index]
      if (!program) return
      onFocusChange(rowIndex, program.start)
      reveal(rowIndex, program)
      pendingFocus.current = true
    },
    [rows, onFocusChange, reveal]
  )

  useImperativeHandle(
    ref,
    () => ({
      jumpToNow() {
        const element = scrollRef.current
        if (!element) return
        const current = Date.now()
        const left = timeToX(defaultViewStart(current), range.start)
        const row = focus ? rows[focus.rowIndex] : undefined
        const top = focus ? revealScrollTop(focus.rowIndex, element.scrollTop, element.clientHeight) : null
        // One scroll both ways: a second one would cut the smooth scroll short.
        element.scrollTo({ left, top: top ?? element.scrollTop, behavior: 'smooth' })
        if (!focus || !row) return
        const program = row.programs[indexAtTime(row.programs, current, range)]
        if (program) onFocusChange(focus.rowIndex, program.start)
      }
    }),
    [focus, rows, range, onFocusChange]
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !focus) return
    const element = scrollRef.current
    const row = rows[focus.rowIndex]
    if (!element || !row) return
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault()
        const next = neighbourIndex(row.programs, focus.index, event.key === 'ArrowLeft' ? -1 : 1, range)
        if (next !== -1) moveTo(focus.rowIndex, next)
        return
      }
      case 'ArrowUp':
      case 'ArrowDown':
      case 'PageUp':
      case 'PageDown': {
        event.preventDefault()
        const page = event.key === 'PageUp' || event.key === 'PageDown'
        const step = page ? Math.max(1, Math.floor((element.clientHeight - HEADER_HEIGHT) / ROW_PITCH) - 1) : 1
        const direction = event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 1
        // Keep to the time in view: the focused programme's start, or the
        // left edge when it began before it.
        const current = row.programs[focus.index]
        const viewStart = xToTime(element.scrollLeft, range.start) + MINUTE_MS
        const anchor = current ? Math.min(Math.max(viewStart, current.start), current.end - 1) : viewStart
        let target = Math.min(rows.length - 1, Math.max(0, focus.rowIndex + direction * step))
        while (target !== focus.rowIndex) {
          const index = indexAtTime(rows[target]!.programs, anchor, range)
          if (index !== -1) {
            moveTo(target, index)
            return
          }
          target -= direction
        }
        return
      }
      case 'Enter':
        event.preventDefault()
        onPlay(focus.rowIndex)
        return
      case 'f':
      case 'F':
        if (event.shiftKey) return
        event.preventDefault()
        onToggleFavorite(focus.rowIndex)
        return
    }
  }

  // With the focused block scrolled out of the drawn window, the scroller
  // itself takes the tab stop and hands it on when reached from the keyboard.
  const focusedProgram = focus ? rows[focus.rowIndex]?.programs[focus.index] : undefined
  const focusDrawn =
    !!focus &&
    !!focusedProgram &&
    virtualRows.some((item) => item.index === focus.rowIndex) &&
    focusedProgram.end > drawn.from &&
    focusedProgram.start < drawn.to
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !focus || !event.currentTarget.matches(':focus-visible')) return
    moveTo(focus.rowIndex, focus.index)
  }

  const marks = useMemo(() => {
    const out: number[] = []
    const first = Math.max(floorTo(drawn.from, HALF_HOUR_MS), range.start)
    for (let ts = first; ts < Math.min(drawn.to, range.end); ts += HALF_HOUR_MS) out.push(ts)
    return out
  }, [drawn, range])

  const nowX = column + timeToX(now, range.start)
  const nowInRange = now >= range.start && now < range.end

  return (
    <div
      ref={scrollRef}
      data-testid="epg-scroll"
      role="region"
      aria-label={text.timelineLabel}
      tabIndex={focusDrawn ? -1 : 0}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-offset-[-3px]"
    >
      <div className="relative" style={{ width: contentWidth, height: totalHeight }}>
        <div className="sticky top-0 z-[4] bg-ground" style={{ height: HEADER_HEIGHT, width: contentWidth }}>
          <div className="sticky left-0 z-[2] flex h-full items-center gap-2 bg-ground" style={{ width: column }}>
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-sun" />
            <h2 className="truncate text-base font-bold">{dayLabel(drawn.from + HOUR_MS, now)}</h2>
          </div>
          {marks.map((ts) => (
            <div
              key={ts}
              className="absolute top-0 flex h-full items-center whitespace-nowrap text-[15px] font-bold tabular-nums text-surface-500"
              style={{ left: column + timeToX(ts, range.start) + BLOCK_INSET }}
            >
              {formatTime(ts)}
            </div>
          ))}
          {nowInRange && (
            <>
              <div aria-hidden="true" className="absolute bottom-0 top-7 z-[1] -ml-[1.5px] w-[3px] bg-coral" style={{ left: nowX }} />
              <div
                className="absolute top-0.5 z-[1] flex h-7 -translate-x-1/2 items-center whitespace-nowrap rounded-full bg-coral px-2.5 text-[15px] font-bold tabular-nums text-ink"
                style={{ left: nowX }}
              >
                <span className="sr-only">{text.nowMarker} </span>
                {formatTime(now)}
              </div>
            </>
          )}
        </div>

        <div role="list" aria-label={text.listLabel}>
          {virtualRows.map((item) => {
            const row = rows[item.index]
            if (!row) return null
            return (
              <GuideRowView
                key={row.channel.id}
                row={row}
                rowIndex={item.index}
                top={item.start}
                contentWidth={contentWidth}
                column={column}
                drawn={drawn}
                range={range}
                focusedIndex={focus && focus.rowIndex === item.index ? focus.index : -1}
                favorite={favoriteIds.has(row.channel.id)}
                now={now}
                formatTime={formatTime}
                onPick={onFocusChange}
                onPlay={onPlay}
              />
            )
          })}
        </div>

        {nowInRange && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-[2] -ml-[1.5px] w-[3px] rounded-b-full bg-coral"
            style={{ left: nowX, top: HEADER_HEIGHT, height: Math.max(0, totalHeight - HEADER_HEIGHT) }}
          />
        )}
      </div>
    </div>
  )
})
