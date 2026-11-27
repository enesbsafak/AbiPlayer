import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, X } from 'lucide-react'
import { useStore } from '@/store'
import { channelPrograms } from '@/services/epg-service'
import { matchesSearch, normalizeSearchKey, useVisibleCatalogCategories, useVisibleCatalogItems } from '@/catalog'
import { loadEpg } from '@/hooks/useEPG'
import { useOpenCatalogItem } from '@/hooks/useOpenCatalogItem'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Spinner } from '@/components/ui/Spinner'
import { SearchIcon } from '@/components/ui/icons'
import { PRIMARY_PILL } from '@/components/home/home-ui'
import { GuideDetail } from '@/components/epg/GuideDetail'
import { GuideKeyHints, GuideMessage, GuideNotice } from '@/components/epg/GuideStates'
import { GuideTimeline, type GuideTimelineHandle } from '@/components/epg/GuideTimeline'
import { indexAtTime, indexByStart, type GuideFocus, type GuideRow } from '@/components/epg/guide-model'
import type { CatalogItem } from '@/catalog/types'
import type { EPGData } from '@/types/epg'
import type { UserSettings } from '@/types/settings'
import { LOCALE, strings } from '@/strings'

const text = strings.epg

/** The now line, progress bars and the current programme follow the clock this often. */
const NOW_TICK_MS = 30_000
const ALL_CATEGORIES = '__all__'
const WHOLE_TIME = { start: -Infinity, end: Infinity }

export type EpgRow = GuideRow

/** The channels of the list that have guide data, in list order, optionally filtered by a search. */
export function buildEpgRows(channels: readonly CatalogItem[], guide: EPGData | null, query: string): EpgRow[] {
  if (!guide) return []
  const normalizedQuery = query ? normalizeSearchKey(query) : ''
  const rows: EpgRow[] = []
  for (const channel of channels) {
    if (!channel.epgChannelId) continue
    if (normalizedQuery && !matchesSearch(channel, normalizedQuery)) continue
    const programs = channelPrograms(guide.programs, channel)
    if (!programs || programs.length === 0) continue
    rows.push({ channel, programs })
  }
  return rows
}

/** "14:05" or, with the 12-hour setting, "2:05 ÖS". */
export function createTimeFormatter(format: UserSettings['epgTimeFormat']): (ts: number) => string {
  const formatter = new Intl.DateTimeFormat(LOCALE, {
    hour: format === '12h' ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12: format === '12h'
  })
  return (ts) => formatter.format(ts)
}

/** What the notice above the timeline says, if anything. */
export function epgNotice(input: {
  guide: EPGData | null
  fromCache: boolean
  error: string | null
  fetchedAt: number | null
  loading: boolean
}): { tone: 'warning' | 'info'; text: string } | null {
  const { guide, fromCache, error, fetchedAt, loading } = input
  if (!guide) return null
  const when = fetchedAt ? new Date(fetchedAt).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' }) : null
  if (error) {
    return { tone: 'warning', text: text.updateFailed(error, when) }
  }
  if (guide.truncated) {
    return {
      tone: 'warning',
      text: guide.truncatedReason === 'limit' ? text.truncatedLimit : text.truncatedCut
    }
  }
  if (fromCache && when) return { tone: 'info', text: text.cachedCopy(when, loading) }
  return null
}

/**
 * The focused programme: the one picked (by channel and start), while its
 * channel is still listed, else what is on now on the first channel.
 */
export function resolveGuideFocus(
  rows: readonly EpgRow[],
  rowIndexById: ReadonlyMap<string, number>,
  picked: { channelId: string; start: number } | null,
  now: number
): GuideFocus | null {
  if (picked) {
    const rowIndex = rowIndexById.get(picked.channelId)
    const row = rowIndex === undefined ? undefined : rows[rowIndex]
    const index = row ? indexByStart(row.programs, picked.start) : -1
    if (rowIndex !== undefined && index !== -1) return { rowIndex, index }
  }
  const first = rows[0]
  if (!first) return null
  const index = indexAtTime(first.programs, now, WHOLE_TIME)
  return index === -1 ? null : { rowIndex: 0, index }
}

/** The clock, ticking every `intervalMs`, so programmes and progress bars stay current. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * Yayın Akışı: a timeline guide. The focused programme's strip with the one
 * primary action on top, a toolbar (search, category, count, back to now,
 * refresh), and the timeline of every listed channel that has guide data.
 */
export default function EPGPage() {
  const navigate = useNavigate()
  const epgData = useStore((s) => s.epgData)
  const epgSourceId = useStore((s) => s.epgSourceId)
  const epgLoading = useStore((s) => s.epgLoading)
  const epgError = useStore((s) => s.epgError)
  const epgFromCache = useStore((s) => s.epgFromCache)
  const epgLastFetched = useStore((s) => s.epgLastFetched)
  const timeFormat = useStore((s) => s.settings.epgTimeFormat)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const favoriteIds = useStore((s) => s.favoriteIds)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const openItem = useOpenCatalogItem()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ channelId: string; start: number } | null>(null)
  const visibleCategories = useVisibleCatalogCategories(activeSourceId, 'live')
  const visibleChannels = useVisibleCatalogItems(activeSourceId, 'live', selectedCategoryId)
  const sourceEpgData = activeSourceId && epgSourceId === activeSourceId ? epgData : null
  const now = useNow(NOW_TICK_MS)
  const formatTime = useMemo(() => createTimeFormatter(timeFormat), [timeFormat])
  const timelineRef = useRef<GuideTimelineHandle>(null)
  const categoryLabelId = useId()

  const refetchEPG = useCallback(() => {
    if (activeSourceId) void loadEpg(activeSourceId, { force: true })
  }, [activeSourceId])

  // Live categories for the filter, without separator entries ("---", "***", "===", "~~~").
  const categoryItems = useMemo(
    () => [
      { id: ALL_CATEGORIES, label: text.allChannels },
      ...visibleCategories
        .filter((category) => category.name.replace(/[-=*~_.#|/\\► ]/g, '').trim().length > 0)
        .map((category) => ({ id: category.id, label: category.name }))
    ],
    [visibleCategories]
  )

  // Channels with guide data. What is on is worked out per visible row.
  const rows = useMemo(() => buildEpgRows(visibleChannels, sourceEpgData, searchQuery), [visibleChannels, sourceEpgData, searchQuery])
  const rowIndexById = useMemo(() => new Map(rows.map((row, index) => [row.channel.id, index])), [rows])
  const focus = useMemo(() => resolveGuideFocus(rows, rowIndexById, picked, now), [rows, rowIndexById, picked, now])
  const focusedRow = focus ? rows[focus.rowIndex] : undefined
  const focusedProgram = focus ? focusedRow?.programs[focus.index] : undefined

  const handleFocusChange = useCallback(
    (rowIndex: number, start: number) => {
      const row = rows[rowIndex]
      if (row) setPicked({ channelId: row.channel.id, start })
    },
    [rows]
  )
  const handlePlay = useCallback(
    (rowIndex: number) => {
      const row = rows[rowIndex]
      if (row) openItem(row.channel)
    },
    [rows, openItem]
  )
  const handleToggleFavorite = useCallback(
    (rowIndex: number) => {
      const row = rows[rowIndex]
      if (row) toggleFavorite(row.channel.id, row.channel)
    },
    [rows, toggleFavorite]
  )

  const notice = epgNotice({
    guide: sourceEpgData,
    fromCache: epgFromCache,
    error: sourceEpgData ? epgError : null,
    fetchedAt: epgLastFetched,
    loading: epgLoading
  })

  let content
  if (rows.length > 0) {
    content = (
      <GuideTimeline
        ref={timelineRef}
        rows={rows}
        focus={focus}
        now={now}
        formatTime={formatTime}
        favoriteIds={favoriteIds}
        onFocusChange={handleFocusChange}
        onPlay={handlePlay}
        onToggleFavorite={handleToggleFavorite}
      />
    )
  } else if (sourceEpgData) {
    content = searchQuery ? (
      <GuideMessage title={text.noSearchMatch} hint={text.noSearchMatchHint} />
    ) : (
      <GuideMessage title={text.noGuideInCategory} hint={selectedCategoryId ? text.noGuideInCategoryHint : undefined} />
    )
  } else if (!activeSourceId) {
    content = (
      <GuideMessage
        title={text.noSource}
        hint={text.noSourceHint}
        action={
          <button type="button" onClick={() => void navigate('/settings')} className={PRIMARY_PILL}>
            {strings.common.addSource}
          </button>
        }
      />
    )
  } else if (epgError && !epgLoading) {
    content = (
      <GuideMessage
        title={text.loadFailedTitle}
        hint={epgError}
        action={
          <button type="button" onClick={refetchEPG} className={PRIMARY_PILL}>
            <RefreshCw size={20} aria-hidden="true" />
            {strings.common.retry}
          </button>
        }
      />
    )
  } else {
    content = <GuideMessage loading title={text.loading} hint={text.loadingHint} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3 short:gap-3">
      {focusedRow && focusedProgram && (
        <GuideDetail
          channel={focusedRow.channel}
          program={focusedProgram}
          favorite={favoriteIds.has(focusedRow.channel.id)}
          now={now}
          formatTime={formatTime}
          twelveHour={timeFormat === '12h'}
          onPlay={() => openItem(focusedRow.channel)}
        />
      )}

      <div className="flex shrink-0 items-center gap-3">
        <div className="flex h-11 min-w-[150px] flex-[0_1_320px] items-center gap-2.5 rounded-full bg-raised pl-4 pr-1.5 text-white focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-[3px] focus-within:outline-sun">
          <SearchIcon size={20} className="shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label={text.searchLabel}
            placeholder={text.searchPlaceholder}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-surface-500 focus-visible:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label={text.clearSearch}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-surface-400 transition-colors hover:bg-surface-800 hover:text-white"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        {categoryItems.length > 1 && (
          <div className="min-w-[130px] flex-[0_1_220px]">
            <span id={categoryLabelId} className="sr-only">
              {text.categoryLabel}
            </span>
            <Dropdown
              items={categoryItems}
              value={selectedCategoryId ?? ALL_CATEGORIES}
              onSelect={(id) => setSelectedCategoryId(id === ALL_CATEGORIES ? null : id)}
              labelledBy={categoryLabelId}
            />
          </div>
        )}

        {sourceEpgData && <span className="shrink-0 whitespace-nowrap text-[15px] text-surface-500">{text.channelCount(rows.length)}</span>}

        <div className="flex-1" />

        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => timelineRef.current?.jumpToNow()}
            title={text.jumpToNowHint}
            className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-raised pl-4 pr-[18px] font-bold text-white transition-colors hover:bg-surface-800"
          >
            <span aria-hidden="true" className="size-2.5 rounded-full bg-coral" />
            {text.jumpToNow}
          </button>
        )}

        <Button variant="secondary" onClick={refetchEPG} disabled={epgLoading} className="h-11 shrink-0 text-[15px]">
          {epgLoading ? <Spinner size={16} /> : <RefreshCw size={16} aria-hidden="true" />}
          {strings.common.refresh}
        </Button>
      </div>

      {notice && <GuideNotice tone={notice.tone}>{notice.text}</GuideNotice>}

      {content}

      {rows.length > 0 && <GuideKeyHints />}
    </div>
  )
}
