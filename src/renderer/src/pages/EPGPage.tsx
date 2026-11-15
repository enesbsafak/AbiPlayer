import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, RefreshCw, Search, X } from 'lucide-react'
import { useStore } from '@/store'
import { findCurrentProgram, getUpcomingPrograms, normalizeEpgChannelKey } from '@/services/epg-service'
import { matchesSearch, normalizeSearchKey, useVisibleCatalogCategories, useVisibleCatalogItems } from '@/catalog'
import { loadEpg } from '@/hooks/useEPG'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { LazyImage } from '@/components/ui/LazyImage'
import type { CatalogItem } from '@/catalog/types'
import type { EPGData, EPGProgram } from '@/types/epg'
import type { UserSettings } from '@/types/settings'
import { LOCALE, strings } from '@/strings'

const text = strings.epg

/** Height of one channel row; rows are virtualized, so only the visible ones exist. */
const ROW_HEIGHT = 76
/** The "now" marker, progress bars and the current programme follow the clock this often. */
const NOW_TICK_MS = 30_000

export interface EpgRow {
  channel: CatalogItem
  programs: EPGProgram[]
}

/** The channels of the list that have guide data, in list order, optionally filtered by a search. */
export function buildEpgRows(channels: readonly CatalogItem[], guide: EPGData | null, query: string): EpgRow[] {
  if (!guide) return []
  const normalizedQuery = query ? normalizeSearchKey(query) : ''
  const rows: EpgRow[] = []
  for (const channel of channels) {
    if (!channel.epgChannelId) continue
    if (normalizedQuery && !matchesSearch(channel, normalizedQuery)) continue
    const key = normalizeEpgChannelKey(channel.epgChannelId)
    const programs = key ? guide.programs[key] : undefined
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

/** What the notice above the list says, if anything. */
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

/** The clock, ticking every `intervalMs`, so programmes and progress bars stay current. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

const EpgRowView = memo(function EpgRowView({
  row,
  now,
  formatTime
}: {
  row: EpgRow
  now: number
  formatTime: (ts: number) => string
}) {
  const { channel, programs } = row
  const current = findCurrentProgram(programs, now)
  const upcoming = getUpcomingPrograms(programs, 3, now).filter((program) => program !== current)
  const progress = current ? Math.min(100, Math.max(0, ((now - current.start) / (current.end - current.start)) * 100)) : 0

  return (
    <div className="flex h-full border-b border-surface-800 hover:bg-surface-800/30 transition-colors">
      <div className="w-48 shrink-0 flex items-center gap-3 px-4 py-3 border-r border-surface-800">
        <LazyImage
          src={channel.logo}
          alt=""
          fit="contain"
          className="size-8 shrink-0 rounded bg-surface-800"
          fallbackClassName="size-8 shrink-0 rounded"
        />
        <span className="text-sm font-medium truncate">{channel.name}</span>
      </div>

      <div className="flex-1 min-w-0 flex items-stretch">
        {current ? (
          <div className="flex-1 min-w-0 px-4 py-2.5 border-r border-surface-800/50">
            <div className="flex items-center gap-2 mb-1">
              <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-caption font-medium text-accent">{text.now}</span>
              <span className="text-xs text-surface-500">
                {formatTime(current.start)} - {formatTime(current.end)}
              </span>
            </div>
            <p className="text-sm font-medium truncate">{current.title}</p>
            {current.description && <p className="text-xs text-surface-500 truncate mt-0.5">{current.description}</p>}
            <div
              className="mt-1.5 h-1 w-full rounded-full bg-surface-700"
              role="progressbar"
              aria-label={text.progress(current.title)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            >
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex-1 min-w-0 px-4 py-3 border-r border-surface-800/50 flex items-center">
            <span className="text-xs text-surface-600">{text.noProgram}</span>
          </div>
        )}

        <div className="w-72 shrink-0 p-3 flex flex-col justify-center gap-1">
          {upcoming.length > 0 ? (
            upcoming.slice(0, 2).map((prog) => (
              <div key={prog.start} className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 text-caption text-surface-500 w-14">{formatTime(prog.start)}</span>
                <p className="text-xs text-surface-400 truncate">{prog.title}</p>
              </div>
            ))
          ) : (
            <span className="text-xs text-surface-600">{text.noUpcoming}</span>
          )}
        </div>
      </div>
    </div>
  )
})

export default function EPGPage() {
  const epgData = useStore((s) => s.epgData)
  const epgSourceId = useStore((s) => s.epgSourceId)
  const epgLoading = useStore((s) => s.epgLoading)
  const epgError = useStore((s) => s.epgError)
  const epgFromCache = useStore((s) => s.epgFromCache)
  const epgLastFetched = useStore((s) => s.epgLastFetched)
  const timeFormat = useStore((s) => s.settings.epgTimeFormat)
  const activeSourceId = useStore((s) => s.activeSourceId)

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const visibleCategories = useVisibleCatalogCategories(activeSourceId, 'live')
  const visibleChannels = useVisibleCatalogItems(activeSourceId, 'live', selectedCategoryId)
  const sourceEpgData = activeSourceId && epgSourceId === activeSourceId ? epgData : null
  const now = useNow(NOW_TICK_MS)
  const formatTime = useMemo(() => createTimeFormatter(timeFormat), [timeFormat])
  const scrollRef = useRef<HTMLDivElement>(null)

  const refetchEPG = useCallback(() => {
    if (activeSourceId) void loadEpg(activeSourceId, { force: true })
  }, [activeSourceId])

  // Live categories for filter — skip separator/decorative entries
  const liveCategories = useMemo(
    () =>
      visibleCategories.filter((c) => {
        // Skip separator categories (e.g. "---", "***", "===", "~~~")
        const cleaned = c.name.replace(/[-=*~_.#|/\\► ]/g, '').trim()
        return cleaned.length > 0
      }),
    [visibleCategories]
  )

  // Channels with guide data. What is current is worked out per visible row.
  const rows = useMemo(() => buildEpgRows(visibleChannels, sourceEpgData, searchQuery), [visibleChannels, sourceEpgData, searchQuery])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6
  })

  const notice = epgNotice({
    guide: sourceEpgData,
    fromCache: epgFromCache,
    error: sourceEpgData ? epgError : null,
    fetchedAt: epgLastFetched,
    loading: epgLoading
  })

  return (
    <div className="flex h-full gap-3 p-3">
      {/* Sidebar: categories */}
      <div className="w-56 shrink-0 flex flex-col overflow-hidden rounded-lg border border-surface-800 bg-surface-900">
        <div className="px-3 pt-3 pb-2">
          <p className="text-xs font-medium text-surface-500">{text.categories}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setSelectedCategoryId(null)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
              !selectedCategoryId ? 'bg-surface-800 text-surface-50 font-medium' : 'text-surface-400 hover:bg-surface-800/50'
            }`}
          >
            {text.allChannels}
          </button>
          {liveCategories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategoryId(cat.id)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors truncate ${
                selectedCategoryId === cat.id ? 'bg-surface-800 text-surface-50 font-medium' : 'text-surface-400 hover:bg-surface-800/50'
              }`}
              title={cat.name}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden rounded-lg border border-surface-800 bg-surface-900">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-surface-800 px-4 py-3">
          <h1 className="text-lg font-semibold shrink-0">{text.title}</h1>
          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-56">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={text.searchLabel}
              placeholder={text.searchPlaceholder}
              className="w-full rounded-lg border border-surface-700 bg-surface-800 py-1.5 pl-8 pr-8 text-sm text-surface-50 placeholder:text-surface-500 focus:border-surface-600 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={text.clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <span className="text-xs text-surface-500 shrink-0">{text.channelCount(rows.length)}</span>

          <Button variant="secondary" size="sm" onClick={refetchEPG} disabled={epgLoading}>
            {epgLoading ? <Spinner size={14} /> : <RefreshCw size={14} />}
            {strings.common.refresh}
          </Button>
        </div>

        {notice && (
          <div
            role={notice.tone === 'warning' ? 'alert' : 'status'}
            className={`flex items-start gap-2 border-b px-4 py-2 text-xs ${
              notice.tone === 'warning'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                : 'border-surface-800 bg-surface-900 text-surface-400'
            }`}
          >
            {notice.tone === 'warning' && <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />}
            <p>{notice.text}</p>
          </div>
        )}

        {/* Content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto" data-testid="epg-scroll">
          {epgLoading && !sourceEpgData && (
            <div className="flex flex-col items-center justify-center py-20 text-surface-500">
              <Spinner size={24} />
              <p className="text-sm mt-3">{text.loading}</p>
            </div>
          )}

          {epgError && !sourceEpgData && !epgLoading && (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-sm text-red-400">{epgError}</p>
              <p className="text-xs text-surface-500 mt-1">{text.retryHint}</p>
            </div>
          )}

          {sourceEpgData && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-surface-500">
              <p className="text-sm">
                {searchQuery ? text.noSearchMatch : text.noGuideInCategory}
              </p>
            </div>
          )}

          {rows.length > 0 && (
            <div role="list" aria-label={text.listLabel} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index]
                if (!row) return null
                return (
                  <div
                    key={row.channel.id}
                    role="listitem"
                    aria-label={row.channel.name}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: item.size, transform: `translateY(${item.start}px)` }}
                  >
                    <EpgRowView row={row} now={now} formatTime={formatTime} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
