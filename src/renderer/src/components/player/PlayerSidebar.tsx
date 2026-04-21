import { useMemo, useRef, useEffect, useCallback, useState } from 'react'
import { X, Play, Radio, ChevronDown, Folder } from 'lucide-react'
import { useStore } from '@/store'
import { isPlayableChannel } from '@/services/playback'
import { mpvSetVideoMargin } from '@/services/platform'
import { ensureFullSync } from '@/services/background-sync'
import { LazyImage } from '@/components/ui/LazyImage'
import { ClampText } from '@/components/ui'
import type { Channel, Category } from '@/types/playlist'

const SIDEBAR_WIDTH = 288

export function PlayerSidebar() {
  const currentChannel = useStore((s) => s.currentChannel)
  const channels = useStore((s) => s.channels)
  const categories = useStore((s) => s.categories)
  const isPlayerSidebarOpen = useStore((s) => s.isPlayerSidebarOpen)
  const setPlayerSidebarOpen = useStore((s) => s.setPlayerSidebarOpen)
  const playbackEngine = useStore((s) => s.playbackEngine)
  const playChannel = useStore((s) => s.playChannel)
  const hydratedSourceIds = useStore((s) => s.hydratedSourceIds)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const storeSelectedCategoryId = useStore((s) => s.selectedCategoryId)
  const activeRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isMpv = playbackEngine === 'mpv'

  // Pick a starting category that matches the current channel's type+source.
  // Prefer the store's active category (the one the user picked on LiveTV / VOD / Series page)
  // over the channel's own categoryId, so opening the sidebar preserves the user's filter.
  const resolveCategoryFor = useCallback(
    (channel: typeof currentChannel): string | null => {
      if (!channel) return null
      const storeCat = storeSelectedCategoryId
        ? categories.find((c) => c.id === storeSelectedCategoryId)
        : null
      if (storeCat && storeCat.type === channel.type && storeCat.sourceId === channel.sourceId) {
        return storeSelectedCategoryId
      }
      return channel.categoryId ?? null
    },
    [categories, storeSelectedCategoryId]
  )

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(() =>
    resolveCategoryFor(currentChannel)
  )
  const [isCategoryOpen, setIsCategoryOpen] = useState(false)
  const categoryDropdownRef = useRef<HTMLDivElement>(null)

  // Only re-sync when the channel itself changes (not when the sidebar toggles).
  // This preserves the user's explicit filter choice across open/close cycles.
  const lastChannelIdRef = useRef<string | null>(currentChannel?.id ?? null)
  useEffect(() => {
    if (currentChannel?.id === lastChannelIdRef.current) return
    lastChannelIdRef.current = currentChannel?.id ?? null
    setSelectedCategoryId(resolveCategoryFor(currentChannel))
  }, [currentChannel, resolveCategoryFor])

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

  // Available categories for this source + type
  const availableCategories = useMemo(() => {
    if (!currentChannel) return []
    return categories.filter(
      (c) => c.type === currentChannel.type && c.sourceId === currentChannel.sourceId
    )
  }, [categories, currentChannel])

  // Current category label
  const activeCategoryLabel = useMemo(() => {
    if (!selectedCategoryId) return 'Tümü'
    const cat = availableCategories.find((c) => c.id === selectedCategoryId)
    return cat?.name || 'Tümü'
  }, [selectedCategoryId, availableCategories])

  // Filtered channels
  const sidebarChannels = useMemo(() => {
    if (!currentChannel) return []
    let list = channels.filter(
      (ch) =>
        ch.type === currentChannel.type &&
        ch.sourceId === currentChannel.sourceId &&
        isPlayableChannel(ch)
    )
    if (selectedCategoryId) {
      list = list.filter((ch) => ch.categoryId === selectedCategoryId)
    }
    return list
  }, [channels, currentChannel, selectedCategoryId])

  // Ensure full channel list is available when sidebar opens
  useEffect(() => {
    if (!isPlayerSidebarOpen || !currentChannel) return
    const sourceId = currentChannel.sourceId
    if (hydratedSourceIds[sourceId]) return
    const creds = getXtreamCredentials(sourceId)
    if (!creds) return
    ensureFullSync(sourceId, currentChannel.type, creds)
  }, [isPlayerSidebarOpen, currentChannel, hydratedSourceIds, getXtreamCredentials])

  // MPV video alignment
  useEffect(() => {
    if (!isMpv) return
    if (isPlayerSidebarOpen) {
      void mpvSetVideoMargin(SIDEBAR_WIDTH).catch(() => undefined)
    } else {
      void mpvSetVideoMargin(0).catch(() => undefined)
    }
  }, [isPlayerSidebarOpen, isMpv])

  // Scroll to active item when sidebar opens or category changes
  useEffect(() => {
    if (isPlayerSidebarOpen && activeRef.current) {
      requestAnimationFrame(() => {
        activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    }
  }, [isPlayerSidebarOpen, selectedCategoryId])

  const handleSelect = useCallback(
    (ch: Channel) => {
      playChannel(ch)
    },
    [playChannel]
  )

  const handleCategorySelect = useCallback((catId: string | null) => {
    setSelectedCategoryId(catId)
    setIsCategoryOpen(false)
    // Scroll to top when switching categories
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [])

  if (!currentChannel) return null

  const typeLabel =
    currentChannel.type === 'live'
      ? 'Kanallar'
      : currentChannel.type === 'series'
        ? 'Diziler'
        : 'Filmler'

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
          onClick={() => setPlayerSidebarOpen(false)}
          className="rounded p-1 text-surface-400 hover:text-white hover:bg-white/8 transition-colors duration-normal"
          aria-label="Kanal listesini kapat"
          title="Kapat (L)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Category selector */}
      {availableCategories.length > 1 && (
        <div ref={categoryDropdownRef} className="relative border-b border-white/6">
          <button
            onClick={() => setIsCategoryOpen(!isCategoryOpen)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/4 transition-colors"
          >
            <Folder size={12} className="text-surface-500 shrink-0" />
            <span className="flex-1 text-xs text-surface-200 truncate">{activeCategoryLabel}</span>
            <span className="text-caption text-surface-600 tabular-nums mr-1">{sidebarChannels.length}</span>
            <ChevronDown
              size={12}
              className={`text-surface-500 transition-transform ${isCategoryOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isCategoryOpen && (
            <div className="absolute left-0 right-0 top-full z-dropdown max-h-64 overflow-y-auto border-b border-white/8 bg-surface-950">
              <button
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {sidebarChannels.length === 0 && (
          <div className="py-8 text-center text-xs text-surface-600">
            Bu kategoride içerik yok
          </div>
        )}
        {sidebarChannels.map((ch) => {
          const isActive = ch.id === currentChannel.id
          const artwork = ch.logo || ch.coverUrl
          return (
            <button
              key={ch.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => handleSelect(ch)}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                isActive
                  ? 'bg-accent/10 border-l-2 border-accent'
                  : 'border-l-2 border-transparent hover:bg-white/5'
              }`}
            >
              <div className="relative flex-shrink-0 w-8 h-8 rounded overflow-hidden bg-white/5 flex items-center justify-center">
                {artwork ? (
                  <LazyImage src={artwork} alt={ch.name} className="h-full w-full" fit="cover" />
                ) : (
                  <Radio size={12} className="text-surface-600" />
                )}
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
                  className={`text-label ${isActive ? 'font-semibold text-accent' : 'font-medium text-surface-200'}`}
                >
                  {ch.name}
                </ClampText>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
