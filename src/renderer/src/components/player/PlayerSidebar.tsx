import { useMemo, useRef, useEffect, useCallback, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { X, Play, Radio, ChevronDown, Folder } from 'lucide-react'
import { useStore } from '@/store'
import { selectedCategoryFor } from '@/store/playlist-slice'
import { isPlayableChannel, targetFromChannel } from '@/services/playback'
import { mpvSetVideoMargin } from '@/services/platform'
import { ensureFullSync } from '@/services/background-sync'
import { normalizeImageSrc } from '@/services/image-url'
import { positionInList } from '@/hooks/useAdjacentChannels'
import { useVisibleCatalogCategories, useVisibleCatalogItems, type CatalogType } from '@/catalog'
import { mediaKey } from '../../../../shared/playback'
import { ClampText } from '@/components/ui'
import type { Channel } from '@/types/playlist'

const SIDEBAR_WIDTH = 288
/** One row: 32 px artwork plus padding. */
const ROW_HEIGHT = 44
/** The list stays mounted this long after closing, for the slide-out. */
const UNMOUNT_DELAY_MS = 300

function channelMediaKey(channel: Channel): string | null {
  const target = targetFromChannel(channel)
  return target ? mediaKey(target) : null
}

/** Whether `channel` is what is playing: same media key, whatever its URL. */
export function isPlayingItem(currentMediaKey: string | null | undefined, channel: Channel): boolean {
  return !!currentMediaKey && channelMediaKey(channel) === currentMediaKey
}

function typeLabelOf(type: CatalogType): string {
  return type === 'live' ? 'Kanallar' : type === 'series' ? 'Diziler' : 'Filmler'
}

export function PlayerSidebar() {
  const currentChannel = useStore((s) => s.currentChannel)
  const isPlayerSidebarOpen = useStore((s) => s.isPlayerSidebarOpen)
  const setPlayerSidebarOpen = useStore((s) => s.setPlayerSidebarOpen)
  const playbackEngine = useStore((s) => s.playbackEngine)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const sourceId = currentChannel?.sourceId ?? null
  const type = currentChannel?.type ?? 'live'
  const isTypeComplete = useStore((s) =>
    sourceId ? s.catalogStatus[sourceId]?.[type]?.complete === true : false
  )
  const isMpv = playbackEngine === 'mpv'

  // Opens on the category the user browses for this source and type, else
  // on the channel's own category.
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(() => {
    const state = useStore.getState()
    return selectedCategoryFor(state.selectedCategoryIds, sourceId, type) ?? currentChannel?.categoryId ?? null
  })

  // Only re-sync when the channel itself changes (not when the sidebar toggles).
  // This preserves the user's explicit filter choice across open/close cycles.
  const lastChannelIdRef = useRef<string | null>(currentChannel?.id ?? null)
  useEffect(() => {
    if (currentChannel?.id === lastChannelIdRef.current) return
    lastChannelIdRef.current = currentChannel?.id ?? null
    setSelectedCategoryId(currentChannel?.categoryId ?? null)
  }, [currentChannel])

  // The list (and its artwork) exists only while the sidebar is open, plus
  // the moment it takes to slide out.
  const [isBodyMounted, setIsBodyMounted] = useState(isPlayerSidebarOpen)
  if (isPlayerSidebarOpen && !isBodyMounted) setIsBodyMounted(true)
  useEffect(() => {
    if (isPlayerSidebarOpen) return
    const timer = window.setTimeout(() => setIsBodyMounted(false), UNMOUNT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [isPlayerSidebarOpen])

  // Ensure full channel list is available when sidebar opens
  useEffect(() => {
    if (!isPlayerSidebarOpen || !sourceId) return
    if (isTypeComplete) return
    const creds = getXtreamCredentials(sourceId)
    if (!creds) return
    void ensureFullSync(sourceId, type, creds)
  }, [isPlayerSidebarOpen, sourceId, type, isTypeComplete, getXtreamCredentials])

  // MPV video alignment
  useEffect(() => {
    if (!isMpv) return
    if (isPlayerSidebarOpen) {
      void mpvSetVideoMargin(SIDEBAR_WIDTH).catch(() => undefined)
    } else {
      void mpvSetVideoMargin(0).catch(() => undefined)
    }
  }, [isPlayerSidebarOpen, isMpv])

  if (!currentChannel) return null

  const typeLabel = typeLabelOf(currentChannel.type)

  return (
    <div
      data-player-sidebar
      className={`absolute top-0 bottom-0 right-0 z-sidebar flex flex-col transition-transform duration-normal ease-out ${
        isPlayerSidebarOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{ width: SIDEBAR_WIDTH }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/8">
        <span className="text-label font-semibold text-surface-400 uppercase tracking-wider">
          {typeLabel}
        </span>
        <button
          type="button"
          onClick={() => setPlayerSidebarOpen(false)}
          className="rounded p-1 text-surface-400 hover:text-white hover:bg-white/8 transition-colors duration-normal"
          aria-label="Kanal listesini kapat"
          title="Kapat (L)"
        >
          <X size={14} />
        </button>
      </div>

      {isBodyMounted && sourceId && (
        <SidebarBody
          sourceId={sourceId}
          type={type}
          currentChannel={currentChannel}
          typeLabel={typeLabel}
          isOpen={isPlayerSidebarOpen}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
        />
      )}
    </div>
  )
}

interface SidebarBodyProps {
  sourceId: string
  type: CatalogType
  currentChannel: Channel
  typeLabel: string
  isOpen: boolean
  selectedCategoryId: string | null
  onSelectCategory: (categoryId: string | null) => void
}

function SidebarBody({ sourceId, type, currentChannel, typeLabel, isOpen, selectedCategoryId, onSelectCategory }: SidebarBodyProps) {
  const playChannel = useStore((s) => s.playChannel)
  const currentMediaKey = useStore((s) => s.currentPlayback?.mediaKey ?? null)
  const [isCategoryOpen, setIsCategoryOpen] = useState(false)
  const categoryDropdownRef = useRef<HTMLDivElement>(null)
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)

  const availableCategories = useVisibleCatalogCategories(sourceId, type)
  const activeCategoryLabel = useMemo(() => {
    if (!selectedCategoryId) return 'Tümü'
    return availableCategories.find((c) => c.id === selectedCategoryId)?.name || 'Tümü'
  }, [selectedCategoryId, availableCategories])

  const visibleChannels = useVisibleCatalogItems(sourceId, type, selectedCategoryId)
  const channels = useMemo(() => visibleChannels.filter(isPlayableChannel), [visibleChannels])
  const activeIndex = positionInList(channels, currentChannel.id)

  // Stable between renders, or the virtualizer recomputes every row's position on each one.
  const getItemKey = useCallback((index: number) => channels[index].id, [channels])
  const virtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT,
    getItemKey,
    overscan: 6
  })

  // Close dropdown on outside click
  useEffect(() => {
    if (!isCategoryOpen) return
    const handler = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setIsCategoryOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isCategoryOpen])

  // The playing item in view when the sidebar opens or the category changes,
  // but not on every list update: a full sync landing must not yank the list.
  const scrollTargetRef = useRef({ activeIndex, virtualizer })
  useEffect(() => {
    scrollTargetRef.current = { activeIndex, virtualizer }
  })
  useEffect(() => {
    if (!isOpen || !scrollElement) return
    const { activeIndex: index, virtualizer: list } = scrollTargetRef.current
    if (index >= 0) list.scrollToIndex(index, { align: 'center' })
    else scrollElement.scrollTop = 0
  }, [isOpen, scrollElement, selectedCategoryId])

  const handleSelect = useCallback(
    (ch: Channel) => {
      const { currentPlayback, playerError, reloadPlayback } = useStore.getState()
      // `playChannel` on what is already playing would start it over as a new
      // item and drop the viewer's track choices. A broken stream gets a
      // reload instead (same item, same choices); a healthy one is left
      // alone. Identity is the media key, never the URL.
      if (isPlayingItem(currentPlayback?.mediaKey, ch)) {
        if (playerError) reloadPlayback()
        return
      }
      playChannel(ch)
    },
    [playChannel]
  )

  const handleCategorySelect = (catId: string | null) => {
    onSelectCategory(catId)
    setIsCategoryOpen(false)
  }

  return (
    <>
      {/* Category selector */}
      {availableCategories.length > 1 && (
        <div ref={categoryDropdownRef} className="relative border-b border-white/6">
          <button
            type="button"
            onClick={() => setIsCategoryOpen(!isCategoryOpen)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/4 transition-colors"
          >
            <Folder size={12} className="text-surface-500 shrink-0" />
            <span className="flex-1 text-xs text-surface-200 truncate">{activeCategoryLabel}</span>
            <span className="text-caption text-surface-600 tabular-nums mr-1">{channels.length}</span>
            <ChevronDown
              size={12}
              className={`text-surface-500 transition-transform ${isCategoryOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isCategoryOpen && (
            <div className="absolute left-0 right-0 top-full z-dropdown max-h-64 overflow-y-auto border-b border-white/8 bg-surface-950">
              <button
                type="button"
                onClick={() => handleCategorySelect(null)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  !selectedCategoryId ? 'text-accent bg-accent/8' : 'text-surface-300 hover:bg-white/4'
                }`}
              >
                Tüm {typeLabel}
              </button>
              {availableCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategorySelect(cat.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors truncate ${
                    selectedCategoryId === cat.id ? 'text-accent bg-accent/8' : 'text-surface-300 hover:bg-white/4'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Channel list */}
      <div ref={setScrollElement} className="flex-1 overflow-y-auto">
        {channels.length === 0 ? (
          <div className="py-8 text-center text-xs text-surface-600">
            Bu kategoride içerik yok
          </div>
        ) : (
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((row) => {
              const ch = channels[row.index]
              // The id narrows it to one row cheaply; the media key decides.
              const isActive = ch.id === currentChannel.id && isPlayingItem(currentMediaKey, ch)
              return (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => handleSelect(ch)}
                  aria-current={isActive || undefined}
                  className={`absolute left-0 top-0 w-full flex items-center gap-2.5 px-3 text-left transition-colors ${
                    isActive
                      ? 'bg-accent/10 border-l-2 border-accent'
                      : 'border-l-2 border-transparent hover:bg-white/5'
                  }`}
                  style={{ height: ROW_HEIGHT, transform: `translateY(${row.start}px)` }}
                >
                  <div className="relative flex-shrink-0 size-8 rounded overflow-hidden bg-white/5 flex items-center justify-center">
                    <SidebarThumb src={ch.logo || ch.coverUrl} />
                    {isActive && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <Play size={10} fill="white" color="white" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <ClampText
                      as="p"
                      lines={1}
                      titleText={ch.name}
                      className={`text-label ${isActive ? 'font-semibold text-accent' : 'font-medium text-surface-200'}`}
                    >
                      {ch.name}
                    </ClampText>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

/**
 * A 32 px thumbnail: a plain lazily decoded image without the poster
 * component's observers, timers and shimmer. Providers publish one artwork
 * URL per item, so there is no smaller file to ask for; virtualization keeps
 * the number of rows (and requests) to what is on screen.
 */
function SidebarThumb({ src }: { src?: string }) {
  const normalized = normalizeImageSrc(src)
  const [failed, setFailed] = useState<string | null>(null)
  if (!normalized || failed === normalized) return <Radio size={12} className="text-surface-600" />
  return (
    <img
      src={normalized}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(normalized)}
      className="h-full w-full object-cover"
    />
  )
}
