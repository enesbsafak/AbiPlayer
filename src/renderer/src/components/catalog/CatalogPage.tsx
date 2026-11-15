import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { CategoryList } from '@/components/channels/CategoryList'
import { ChannelSearch } from '@/components/channels/ChannelSearch'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { isTextEntryTarget } from '@/hooks/useKeyboard'
import type { CatalogPageModel } from '@/hooks/useCatalogPage'
import type { CatalogBanner } from '@/hooks/catalog-page-state'
import type { Channel } from '@/types/playlist'
import { VirtualCardGrid, type CardGridLayout, type CardRenderProps } from './VirtualCardGrid'

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
}

interface CatalogPageProps {
  page: CatalogPageModel
  labels: CatalogPageLabels
  layout: CardGridLayout
  renderCard: (props: CardRenderProps<Channel>) => ReactNode
  /** What opening a card means: play it, or open its detail. */
  onOpen: (item: Channel) => void
  empty: ReactNode
  /** The open detail view, drawn above the grid, which stays mounted. */
  detail?: { label: string; content: ReactNode } | null
}

/**
 * The layout every catalog page shares: category list, search, status
 * banners and the grid; a detail view opens above them without unmounting
 * the grid, so going back keeps its scroll position and focus.
 */
export function CatalogPage({ page, labels, layout, renderCard, onOpen, empty, detail }: CatalogPageProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const detailRef = useRef<HTMLDivElement | null>(null)
  const { scrollRef, gridRef, pendingScrollRef, pendingFocusRef, items, isSearchPending, closeDetail } = page
  const detailOpen = !!detail
  const detailKey = page.detail?.itemId ?? null

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

  // Focus moves into the detail when it opens.
  useEffect(() => {
    if (detailKey && detailOpen) detailRef.current?.focus({ preventScroll: true })
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
    <div className="relative flex h-full gap-3 p-3">
      <div
        className={`w-64 shrink-0 overflow-hidden rounded-lg border border-surface-800 bg-surface-900 ${hiddenWhileDetail}`}
        aria-hidden={detailOpen || undefined}
      >
        <CategoryList
          type={page.type}
          sourceId={page.sourceId}
          selectedCategoryId={page.selectedCategoryId}
          onSelect={page.selectCategory}
          allLabel={labels.all}
          error={page.categoriesError}
          onRetry={page.retryCategories}
          loading={page.categoriesLoading}
        />
      </div>

      <div
        className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-surface-800 bg-surface-900 ${hiddenWhileDetail}`}
        aria-hidden={detailOpen || undefined}
      >
        <div className="shrink-0 px-5 pt-5">
          <ChannelSearch value={page.searchQuery} onSearch={page.setSearchQuery} ariaLabel={labels.search} />
          {page.appliedQuery.trim() && (
            <p className="mt-2 flex items-center gap-2 text-xs text-surface-400" aria-live="polite">
              {page.matchCount.toLocaleString('tr-TR')} sonuç
              {isSearchPending && <Spinner size={12} />}
            </p>
          )}
          <div className="mt-4 space-y-3 empty:hidden">
            <Banner banner={page.banner} noun={labels.noun} onRetry={page.retry} foregroundLoading={page.loading} />
            {showInlineLoader && (
              <div className="flex items-center gap-2 rounded-lg border border-surface-800 bg-surface-900 px-4 py-3 text-sm text-surface-200">
                <Spinner size={16} />
                <span>{page.loadingMessage || 'İçerikler yükleniyor...'}</span>
              </div>
            )}
          </div>
        </div>

        <div ref={attachScroll} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
          {showBlockingLoader ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3 text-center">
                <Spinner size={32} />
                <p className="text-sm text-surface-300">{page.loadingMessage || labels.loading}</p>
              </div>
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
            </div>
          )}
        </div>
      </div>

      {detail && (
        <div className="absolute inset-0 p-3">
          <div
            ref={detailRef}
            tabIndex={-1}
            role="region"
            aria-label={detail.label}
            onKeyDown={onDetailKeyDown}
            className="h-full overflow-y-auto rounded-lg border border-surface-800 bg-surface-900 p-5 outline-none"
          >
            {detail.content}
          </div>
        </div>
      )}
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
  if (!banner) return null

  if (banner.kind === 'partial') {
    return (
      <div className="rounded-lg border border-sky-400/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100" role="status">
        <div className="flex items-start gap-3">
          {(banner.syncing || foregroundLoading) && <Spinner size={16} className="mt-0.5 text-sky-200" />}
          <div>
            <p className="font-medium">
              {banner.syncing
                ? `Ön izleme listesi gösteriliyor, tam ${noun} listesi arka planda yükleniyor`
                : 'Bu sayfa önce hızlı bir ön izleme listesiyle açılıyor'}
            </p>
            <p className="mt-1 text-xs leading-5 text-sky-100/80">
              Tam liste gelene kadar arama ve sonuç sayısı eksik olabilir.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const isSync = banner.kind === 'sync-error'
  const canRetry = !isSync || banner.retryable
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          {isSync && <p className="font-medium">Tam {noun} listesi yüklenemedi</p>}
          <p className={isSync ? 'mt-0.5 text-xs leading-5 text-red-200/85' : ''}>{banner.message}</p>
          {isSync && (
            <p className="mt-0.5 text-xs leading-5 text-red-200/85">
              {banner.partial
                ? 'Şimdilik yalnızca yüklenen kısım gösteriliyor; arama ve sonuç sayısı eksik.'
                : 'Liste şu an boş.'}
              {!banner.retryable && ' Kaynak bilgilerini Ayarlar bölümünden kontrol edin.'}
            </p>
          )}
        </div>
      </div>
      {canRetry && (
        <Button size="sm" variant="secondary" className="shrink-0" onClick={onRetry}>
          Tekrar Dene
        </Button>
      )}
    </div>
  )
}
