import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Info, WifiOff } from 'lucide-react'
import { CategoryList } from '@/components/channels/CategoryList'
import { ChannelSearch } from '@/components/channels/ChannelSearch'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { Tone } from '@/components/layout/sections'
import { isTextEntryTarget } from '@/hooks/useKeyboard'
import type { CatalogPageModel, CatalogPagerModel } from '@/hooks/useCatalogPage'
import { offlineCopyBannerText, type CatalogBanner } from '@/hooks/catalog-page-state'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import { SectionHeading } from './SectionHeading'
import { useNearEnd } from './near-end'
import { VirtualCardGrid, type CardGridLayout, type CardRenderProps } from './VirtualCardGrid'

const text = strings.catalog.page
const addonText = strings.catalog.addon

export interface CatalogPageLabels {
  /** The "all" entry of the category list, e.g. "Tüm Kanallar". */
  all: string
  /** Lowercase noun of the list in banners: "kanal", "film", "dizi". */
  noun: string
  /** Accessible name of the grid. */
  grid: string
  /** Shown while the list loads and nothing is on screen yet. */
  loading: string
  /** Accessible name of the search box. */
  search: string
  /** Placeholder of the search box. */
  searchPlaceholder: string
}

interface CatalogPageProps {
  page: CatalogPageModel
  labels: CatalogPageLabels
  /** The section's colour: coral for Canlı TV, mint for Filmler, sky for Diziler. */
  tone: Tone
  layout: CardGridLayout
  renderCard: (props: CardRenderProps<Channel>) => ReactNode
  /** What opening a card means: play it, or open its detail. */
  onOpen: (item: Channel) => void
  empty: ReactNode
  /** The open detail view, drawn above the grid, which stays mounted. */
  detail?: { label: string; content: ReactNode } | null
  /** A panel beside the list (the channel in focus); left out below 1280 px. */
  side?: ReactNode
  /** An add-on without catalogues of this type: what to say instead of the grid. */
  noCategories?: { title: string; hint: string }
}

/**
 * The layout every catalog page shares: the categories as a column of pills,
 * then search, status rows and the grid; a panel beside it where the page
 * has one. A detail view opens over them without unmounting the grid, so
 * going back keeps its scroll position and focus. No frames around frames:
 * the parts sit on the ground and the content carries the colour.
 */
export function CatalogPage({ page, labels, tone, layout, renderCard, onOpen, empty, detail, side, noCategories }: CatalogPageProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const detailRef = useRef<HTMLDivElement | null>(null)
  const { scrollRef, gridRef, pendingScrollRef, pendingFocusRef, items, isSearchPending, closeDetail } = page
  const detailOpen = !!detail
  const detailKey = page.detail?.itemId ?? null
  const { pager } = page

  // An add-on category: the next page when the grid nears its end.
  useNearEnd(scrollElement, !detailOpen && !!pager?.canLoadMore, () => pager?.loadMore(), items.length)

  const attachScroll = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      setScrollElement(node)
    },
    [scrollRef]
  )

  // Restore after returning: the scroll position once the restored query has
  // been applied to the list (an unfiltered list is longer), then the focus
  // once the grid is visible again.
  useLayoutEffect(() => {
    const top = pendingScrollRef.current
    if (top === null || !scrollElement || items.length === 0 || isSearchPending) return
    pendingScrollRef.current = null
    scrollElement.scrollTop = top
  })
  useEffect(() => {
    const id = pendingFocusRef.current
    if (!id || detailOpen || items.length === 0 || isSearchPending || pendingScrollRef.current !== null) return
    pendingFocusRef.current = null
    gridRef.current?.focusItem(id)
  })

  // Focus moves into the detail when it opens, and another item opened from
  // inside a detail starts at its top.
  useEffect(() => {
    if (!detailKey || !detailOpen || !detailRef.current) return
    detailRef.current.scrollTop = 0
    detailRef.current.focus({ preventScroll: true })
  }, [detailKey, detailOpen])

  const onDetailKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const isBack = event.key === 'Escape' || (event.key === 'Backspace' && !isTextEntryTarget(event.target))
    if (!isBack || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    event.stopPropagation()
    closeDetail()
  }

  const showBlockingLoader = page.loading && items.length === 0
  const showInlineLoader = page.loading && items.length > 0
  const hiddenWhileDetail = detailOpen ? 'invisible' : ''

  return (
    <div className="relative flex h-full gap-5 p-3">
      <aside
        className={`flex w-[180px] shrink-0 flex-col gap-3 lg:w-[220px] ${hiddenWhileDetail}`}
        aria-hidden={detailOpen || undefined}
      >
        <SectionHeading tone={tone}>{strings.catalog.categories.label}</SectionHeading>
        <div className="min-h-0 flex-1">
          <CategoryList
            type={page.type}
            sourceId={page.sourceId}
            selectedCategoryId={page.selectedCategoryId}
            onSelect={page.selectCategory}
            allLabel={labels.all}
            error={page.categoriesError}
            onRetry={page.retryCategories}
            loading={page.categoriesLoading}
            showAll={!page.isAddon}
            showCounts={!page.isAddon}
          />
        </div>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col gap-3 ${hiddenWhileDetail}`} aria-hidden={detailOpen || undefined}>
        <div className="flex shrink-0 flex-col gap-3">
          <ChannelSearch
            value={page.searchQuery}
            onSearch={page.setSearchQuery}
            ariaLabel={labels.search}
            placeholder={labels.searchPlaceholder}
          />
          {page.appliedQuery.trim() && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 text-sm text-surface-400" aria-live="polite">
              {strings.common.resultCount(page.matchCount)}
              {isSearchPending && <Spinner size={12} />}
              {/* The box filters what is loaded; it does not search the add-on. */}
              {pager && !pager.ended && <span className="text-surface-500">{addonText.searchLoadedOnly(page.loadedCount)}</span>}
            </p>
          )}
          <div className="flex flex-col gap-2 empty:hidden">
            <Banner banner={page.banner} noun={labels.noun} onRetry={page.retry} foregroundLoading={page.loading} />
            {showInlineLoader && (
              <div className="flex items-center gap-3 rounded-card bg-raised px-5 py-3 text-sm text-white">
                <Spinner size={16} />
                <span>{page.loadingMessage || text.contentLoading}</span>
              </div>
            )}
          </div>
        </div>

        {/* A little inset room, so focus rings at the edges are not clipped. */}
        <div ref={attachScroll} className="-mx-1.5 min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 pt-1.5">
          {showBlockingLoader ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3 text-center">
                <Spinner size={32} />
                <p className="text-base text-surface-400">{page.loadingMessage || labels.loading}</p>
              </div>
            </div>
          ) : page.noCategories && noCategories ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-tile bg-raised px-8 py-16 text-center">
              <p className="font-title text-[28px]">{noCategories.title}</p>
              <p className="max-w-md text-base text-surface-400">{noCategories.hint}</p>
            </div>
          ) : (
            <div className={showInlineLoader ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}>
              <VirtualCardGrid<Channel>
                items={items}
                layout={layout}
                renderCard={renderCard}
                onOpen={onOpen}
                scrollElement={scrollElement}
                ariaLabel={labels.grid}
                empty={empty}
                handleRef={gridRef}
              />
              {pager && <PagerFooter pager={pager} searching={!!page.appliedQuery.trim()} hasItems={items.length > 0} />}
            </div>
          )}
        </div>
      </div>

      {side && (
        <aside
          className={`hidden w-[clamp(320px,24vw,400px)] shrink-0 flex-col xl:flex ${hiddenWhileDetail}`}
          aria-hidden={detailOpen || undefined}
        >
          {side}
        </aside>
      )}

      {detail && (
        <div className="absolute inset-0 bg-ground p-3">
          <div
            ref={detailRef}
            tabIndex={-1}
            role="region"
            aria-label={detail.label}
            onKeyDown={onDetailKeyDown}
            className="-mx-1.5 h-full overflow-y-auto px-1.5 pb-3 pt-1.5 outline-none"
          >
            {detail.content}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Under an add-on category's grid: quiet while the next page loads, a retry
 * when it failed, a line at the end. While a query filters the grid nothing
 * loads by itself (each page could add a match or none); a button asks for
 * the next page instead.
 */
function PagerFooter({ pager, searching, hasItems }: { pager: CatalogPagerModel; searching: boolean; hasItems: boolean }) {
  let content: ReactNode = null
  if (pager.loadingMore) {
    content = (
      <p role="status" className="flex items-center gap-2.5 text-[15px] text-surface-400">
        <Spinner size={16} />
        {addonText.loadingMore}
      </p>
    )
  } else if (pager.error) {
    content = (
      <div role="alert" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[15px]">
        <span className="flex items-center gap-2 text-white">
          <AlertTriangle size={16} className="shrink-0 text-coral" aria-hidden="true" />
          {addonText.pageFailed}
        </span>
        <span className="text-surface-400">{pager.error}</span>
        <Button size="sm" variant="secondary" onClick={pager.retry}>
          {strings.common.retry}
        </Button>
      </div>
    )
  } else if (pager.ended) {
    content = hasItems ? <p className="text-[15px] text-surface-500">{addonText.end}</p> : null
  } else if (searching) {
    content = (
      <Button size="sm" variant="secondary" onClick={pager.loadMore}>
        {addonText.loadMore}
      </Button>
    )
  }
  if (!content) return null
  return <div className="flex min-h-14 items-center justify-center px-4 pb-2 pt-4 text-center">{content}</div>
}

/** A status row: a raised card with a round mark in the colour of what it says. */
function StatusRow({
  role,
  mark,
  title,
  lines,
  action
}: {
  role: 'status' | 'alert'
  mark: 'sun' | 'coral' | 'sky'
  title: ReactNode
  lines?: ReactNode[]
  action?: ReactNode
}) {
  const markClass = { sun: 'bg-sun', coral: 'bg-coral', sky: 'bg-sky' }[mark]
  const Icon = mark === 'coral' ? AlertTriangle : mark === 'sun' ? WifiOff : Info
  return (
    <div role={role} className="flex items-center justify-between gap-4 rounded-card bg-raised py-3 pl-3 pr-4 text-sm text-white">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-ink ${markClass}`}>
          <Icon size={17} strokeWidth={2.4} aria-hidden="true" />
        </span>
        <div className="min-w-0 self-center">
          <div className="font-bold">{title}</div>
          {lines?.map((line, index) => (
            <p key={index} className="mt-0.5 leading-5 text-surface-400">
              {line}
            </p>
          ))}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function Banner({
  banner,
  noun,
  onRetry,
  foregroundLoading
}: {
  banner: CatalogBanner | null
  noun: string
  onRetry: () => void
  foregroundLoading: boolean
}) {
  const navigate = useNavigate()
  const onOpenSourceSettings = () => void navigate('/settings')
  if (!banner) return null

  if (banner.kind === 'offline') {
    return (
      <StatusRow
        role="status"
        mark="sun"
        title={offlineCopyBannerText(banner.since)}
        lines={[text.offlineDetail]}
        action={
          banner.retryable ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {strings.common.retry}
            </Button>
          ) : undefined
        }
      />
    )
  }

  if (banner.kind === 'source-error') {
    return (
      <StatusRow
        role="alert"
        mark="coral"
        title={banner.message}
        action={
          <Button size="sm" variant="secondary" onClick={onOpenSourceSettings}>
            {strings.common.sourceSettings}
          </Button>
        }
      />
    )
  }

  if (banner.kind === 'partial') {
    return (
      <StatusRow
        role="status"
        mark="sky"
        title={
          <span className="flex items-center gap-2">
            {banner.syncing ? text.previewSyncing(noun) : text.previewFirst}
            {(banner.syncing || foregroundLoading) && <Spinner size={14} />}
          </span>
        }
        lines={[text.previewIncomplete]}
      />
    )
  }

  const isSync = banner.kind === 'sync-error'
  const canRetry = !isSync || banner.retryable
  return (
    <StatusRow
      role="alert"
      mark="coral"
      title={isSync ? text.syncFailed(noun) : banner.message}
      lines={
        isSync
          ? [banner.message, `${banner.partial ? text.partialShown : text.listEmpty}${!banner.retryable ? text.checkSourceSettings : ''}`]
          : undefined
      }
      action={
        canRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {strings.common.retry}
          </Button>
        ) : undefined
      }
    />
  )
}
