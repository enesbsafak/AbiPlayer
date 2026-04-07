import { useMemo, useRef, useEffect, useCallback } from 'react'
import { X, Play, Radio, ChevronRight } from 'lucide-react'
import { useStore } from '@/store'
import { isPlayableChannel } from '@/services/playback'
import { mpvSetVideoMargin } from '@/services/platform'
import { LazyImage } from '@/components/ui/LazyImage'
import { ClampText } from '@/components/ui'
import type { Channel } from '@/types/playlist'

const SIDEBAR_WIDTH = 288 // px

export function PlayerSidebar() {
  const {
    currentChannel,
    channels,
    isPlayerSidebarOpen,
    setPlayerSidebarOpen,
    playbackEngine,
    playChannel
  } = useStore()
  const activeRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isMpv = playbackEngine === 'mpv'

  const sidebarChannels = useMemo(() => {
    if (!currentChannel) return []
    return channels.filter(
      (ch) =>
        ch.type === currentChannel.type &&
        ch.sourceId === currentChannel.sourceId &&
        isPlayableChannel(ch)
    )
  }, [channels, currentChannel])

  // Sync MPV video margin with sidebar state
  useEffect(() => {
    if (!isMpv) return
    void mpvSetVideoMargin(isPlayerSidebarOpen ? SIDEBAR_WIDTH : 0).catch(() => undefined)
    return () => {
      void mpvSetVideoMargin(0).catch(() => undefined)
    }
  }, [isPlayerSidebarOpen, isMpv])

  // Scroll to active item when sidebar opens
  useEffect(() => {
    if (isPlayerSidebarOpen && activeRef.current) {
      requestAnimationFrame(() => {
        activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    }
  }, [isPlayerSidebarOpen])

  const handleSelect = useCallback(
    (ch: Channel) => {
      playChannel(ch)
    },
    [playChannel]
  )

  if (!currentChannel) return null

  const typeLabel =
    currentChannel.type === 'live'
      ? 'Kanallar'
      : currentChannel.type === 'series'
        ? 'Bölümler'
        : 'Filmler'

  return (
    <div
      data-player-sidebar
      className={`absolute top-0 bottom-0 right-0 z-40 flex flex-col transition-transform duration-200 ease-out ${
        isPlayerSidebarOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{ width: SIDEBAR_WIDTH }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
        <div className="flex items-center gap-2">
          <ChevronRight size={14} className="text-surface-500" />
          <span className="text-xs font-semibold text-surface-200 uppercase tracking-wider">
            {typeLabel}
          </span>
          <span className="text-[10px] text-surface-500 tabular-nums">
            {sidebarChannels.length}
          </span>
        </div>
        <button
          onClick={() => setPlayerSidebarOpen(false)}
          className="rounded p-1 text-surface-400 hover:text-white hover:bg-white/8 transition-colors"
          title="Kapat (L)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Channel list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {sidebarChannels.map((ch) => {
          const isActive = ch.id === currentChannel.id
          const artwork = ch.logo || ch.coverUrl
          return (
            <button
              key={ch.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => handleSelect(ch)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                isActive
                  ? 'bg-accent/12 border-l-2 border-accent'
                  : 'border-l-2 border-transparent hover:bg-white/5'
              }`}
            >
              <div className="relative flex-shrink-0 w-9 h-9 rounded overflow-hidden bg-white/5 flex items-center justify-center">
                {artwork ? (
                  <LazyImage
                    src={artwork}
                    alt={ch.name}
                    className="h-full w-full"
                    fit="cover"
                  />
                ) : (
                  <Radio size={14} className="text-surface-600" />
                )}
                {isActive && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <Play size={12} fill="white" color="white" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <ClampText
                  as="p"
                  lines={1}
                  className={`text-xs leading-4 ${isActive ? 'font-semibold text-accent' : 'font-medium text-surface-200'}`}
                >
                  {ch.name}
                </ClampText>
                {ch.categoryName && (
                  <ClampText as="p" lines={1} className="text-[10px] leading-3 text-surface-600 mt-0.5">
                    {ch.categoryName}
                  </ClampText>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
