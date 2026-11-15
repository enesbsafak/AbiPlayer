import { useMemo, useRef, useEffect, useCallback, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, Folder } from 'lucide-react'
import { CloseIcon, LiveIcon } from '@/components/ui/icons'
import type { Tone } from '@/components/layout/sections'
import { useStore } from '@/store'
import { selectedCategoryFor } from '@/store/playlist-slice'
import { isPlayableChannel, targetFromChannel } from '@/services/playback'
import { mpvSetVideoMargin } from '@/services/platform'
import { ensureFullSync } from '@/services/background-sync'
import { normalizeImageSrc } from '@/services/image-url'
import { positionInList } from '@/hooks/useAdjacentChannels'
import { formatClockTime, useMinuteClock } from '@/hooks/useMinuteClock'
import { useVisibleCatalogCategories, useVisibleCatalogItems, type CatalogType } from '@/catalog'
import { mediaKey } from '../../../../shared/playback'
import { ClampText } from '@/components/ui'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import { filledClasses, menuRow, playerTone } from './player-ui'
import { onAirFor, useSourceGuide } from './player-guide'

const text = strings.player.sidebar

/** Also the right margin mpv keeps the picture out of while the list is open. */
export const SIDEBAR_WIDTH = 288
/** The gap under each row. */
const ROW_GAP = 4
/** One row: 52 px plus the gap under it. */
const ROW_HEIGHT = 52 + ROW_GAP
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

  const typeLabel = strings.catalog.types[currentChannel.type].plural

  return (
    <div
      data-player-sidebar
      className={`absolute top-0 bottom-0 right-0 z-sidebar flex flex-col text-white transition-transform duration-normal ease-out ${
        isPlayerSidebarOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{ width: SIDEBAR_WIDTH }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-2 pl-5 pr-3 pt-3">
        <h2 className="font-title truncate text-[26px] leading-[1.15]">{typeLabel}</h2>
        <button
          type="button"
          onClick={() => setPlayerSidebarOpen(false)}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-raised text-white transition-colors duration-normal hover:bg-surface-800"
          aria-label={text.close}
          title={text.closeTitle}
        >
          <CloseIcon size={18} />
        </button>
      </div>

      {isBodyMounted && sourceId && (
        <SidebarBody
          sourceId={sourceId}
          type={type}
          currentChannel={currentChannel}
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
  isOpen: boolean
  selectedCategoryId: string | null
  onSelectCategory: (categoryId: string | null) => void
}

function SidebarBody({ sourceId, type, currentChannel, isOpen, selectedCategoryId, onSelectCategory }: SidebarBodyProps) {
  const playChannel = useStore((s) => s.playChannel)
  const currentPlayback = useStore((s) => s.currentPlayback)
  const currentMediaKey = currentPlayback?.mediaKey ?? null
  const tone = playerTone(currentPlayback, currentChannel)
  const guide = useSourceGuide(type === 'live' ? sourceId : null)
  const now = useMinuteClock()
  const [isCategoryOpen, setIsCategoryOpen] = useState(false)
  const categoryDropdownRef = useRef<HTMLDivElement>(null)
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)

  const availableCategories = useVisibleCatalogCategories(sourceId, type)
  const activeCategoryLabel = useMemo(() => {
    if (!selectedCategoryId) return text.all
    return availableCategories.find((c) => c.id === selectedCategoryId)?.name || text.all
  }, [selectedCategoryId, availableCategories])

  const visibleChannels = useVisibleCatalogItems(sourceId, type, selectedCategoryId)
  const channels = useMemo(() => visibleChannels.filter(isPlayableChannel), [visibleChannels])
  const activeIndex = positionInList(channels, currentChannel.id)

  // Stable between renders, or the virtualizer recomputes every row's position on each one.
  const getItemKey = useCallback((index: number) => channels[index]?.id ?? index, [channels])
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
        <div ref={categoryDropdownRef} className="relative px-3 pb-2">
          <button
            type="button"
            onClick={() => setIsCategoryOpen(!isCategoryOpen)}
            aria-expanded={isCategoryOpen}
            title={text.category}
            className={`flex h-11 w-full items-center gap-2.5 rounded-full pl-4 pr-3.5 text-left transition-colors ${
              isCategoryOpen ? filledClasses(tone) : 'bg-raised text-white hover:bg-surface-800'
            }`}
          >
            <Folder size={16} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{activeCategoryLabel}</span>
            <span className={`text-[13px] font-medium tabular-nums ${isCategoryOpen ? 'text-ink' : 'text-surface-500'}`}>
              {channels.length}
            </span>
            <ChevronDown
              size={16}
              strokeWidth={2.6}
              aria-hidden="true"
              className={`shrink-0 transition-transform ${isCategoryOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isCategoryOpen && (
            <div className="absolute inset-x-3 top-full z-dropdown max-h-[min(24rem,60vh)] space-y-1 overflow-y-auto rounded-card bg-raised p-1.5">
              <button
                type="button"
                onClick={() => handleCategorySelect(null)}
                className={menuRow(!selectedCategoryId, tone)}
              >
                <span className="truncate">{strings.catalog.types[type].all}</span>
              </button>
              {availableCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategorySelect(cat.id)}
                  className={menuRow(selectedCategoryId === cat.id, tone)}
                >
                  <span className="truncate">{cat.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Channel list */}
      <div ref={setScrollElement} className="flex-1 overflow-y-auto px-3 pb-3">
        {channels.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-[15px] font-bold">{text.empty}</p>
            {availableCategories.length > 1 && <p className="mt-1 text-[14px] text-surface-500">{text.emptyHint}</p>}
          </div>
        ) : (
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((row) => {
              const ch = channels[row.index]
              if (!ch) return null
              // The id narrows it to one row cheaply; the media key decides.
              const isActive = ch.id === currentChannel.id && isPlayingItem(currentMediaKey, ch)
              const onAir = type === 'live' ? onAirFor(guide, ch, now).now : null
              return (
                <SidebarRow
                  key={row.key}
                  channel={ch}
                  number={type === 'live' ? positionInList(visibleChannels, ch.id) + 1 : null}
                  programme={onAir?.title ?? null}
                  ends={onAir ? formatClockTime(onAir.end) : null}
                  isActive={isActive}
                  tone={tone}
                  top={row.start}
                  onSelect={handleSelect}
                />
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

interface SidebarRowProps {
  channel: Channel
  /** Live: its place in the list shown (the dock's coral tile shows the same). */
  number: number | null
  /** Live with a guide: what is on now, and when it ends. */
  programme: string | null
  ends: string | null
  isActive: boolean
  tone: Tone
  top: number
  onSelect: (channel: Channel) => void
}

/** One item: what is playing is filled with its section colour, ink on it. */
function SidebarRow({ channel, number, programme, ends, isActive, tone, top, onSelect }: SidebarRowProps) {
  const sub = isActive ? 'text-ink' : 'text-surface-500'
  return (
    <button
      type="button"
      onClick={() => onSelect(channel)}
      aria-current={isActive || undefined}
      className={`absolute left-0 top-0 flex w-full items-center gap-2.5 rounded-card pl-1.5 pr-3.5 text-left transition-colors ${
        isActive ? filledClasses(tone) : 'text-white hover:bg-raised'
      }`}
      style={{ height: ROW_HEIGHT - ROW_GAP, transform: `translateY(${top}px)` }}
    >
      {number !== null && number > 0 ? (
        <span
          className={`font-title w-[38px] shrink-0 text-center tabular-nums ${number >= 1000 ? 'text-[15px]' : number >= 100 ? 'text-[18px]' : 'text-[22px]'}`}
        >
          {number}
        </span>
      ) : (
        // Films and series get their poster upright; a channel's logo is square.
        <span
          className={`flex shrink-0 items-center justify-center overflow-hidden bg-raised ${
            channel.type === 'live' ? 'size-10 rounded-[12px]' : 'h-11 w-[30px] rounded-[8px]'
          }`}
        >
          <SidebarThumb src={channel.logo || channel.coverUrl} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <ClampText as="span" lines={1} titleText={channel.name} className="text-[15px] font-bold leading-5">
          {channel.name}
        </ClampText>
        {programme && <span className={`truncate text-[13px] leading-[18px] ${sub}`}>{programme}</span>}
      </span>
      {ends && <span className={`shrink-0 text-[13px] font-medium tabular-nums ${sub}`}>{ends}</span>}
    </button>
  )
}

/**
 * A small thumbnail: a plain lazily decoded image without the poster
 * component's observers, timers and shimmer. Providers publish one artwork
 * URL per item, so there is no smaller file to ask for; virtualization keeps
 * the number of rows (and requests) to what is on screen.
 */
function SidebarThumb({ src }: { src?: string }) {
  const normalized = normalizeImageSrc(src)
  const [failed, setFailed] = useState<string | null>(null)
  if (!normalized || failed === normalized) return <LiveIcon size={18} className="text-surface-600" />
  return (
    <img
      src={normalized}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(normalized)}
      className="h-full w-full object-cover"
    />
  )
}
