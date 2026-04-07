import { useMemo, useRef, useEffect } from 'react'
import { X, Play, Radio } from 'lucide-react'
import { useStore } from '@/store'
import { isPlayableChannel } from '@/services/playback'
import { LazyImage } from '@/components/ui/LazyImage'
import { ClampText } from '@/components/ui'
import type { Channel } from '@/types/playlist'

export function PlayerSidebar() {
  const {
    currentChannel,
    channels,
    isPlayerSidebarOpen,
    setPlayerSidebarOpen,
    playChannel
  } = useStore()
  const activeRef = useRef<HTMLButtonElement>(null)

  const sidebarChannels = useMemo(() => {
    if (!currentChannel) return []
    return channels.filter(
      (ch) =>
        ch.type === currentChannel.type &&
        ch.sourceId === currentChannel.sourceId &&
        isPlayableChannel(ch)
    )
  }, [channels, currentChannel])

  useEffect(() => {
    if (isPlayerSidebarOpen && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [isPlayerSidebarOpen])

  if (!isPlayerSidebarOpen || !currentChannel) return null

  const handleSelect = (ch: Channel) => {
    playChannel(ch)
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 z-30 flex flex-col w-72 bg-surface-900/95 backdrop-blur-xl border-l border-white/10 shadow-2xl animate-in slide-in-from-right duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-semibold text-white truncate">
          {currentChannel.type === 'live'
            ? 'Kanallar'
            : currentChannel.type === 'series'
              ? 'Bölümler'
              : 'Filmler'}
        </span>
        <button
          onClick={() => setPlayerSidebarOpen(false)}
          className="rounded-lg p-1.5 hover:bg-white/10 transition-colors"
          title="Kapat"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-surface-600">
        {sidebarChannels.map((ch) => {
          const isActive = ch.id === currentChannel.id
          const artwork = ch.logo || ch.coverUrl
          return (
            <button
              key={ch.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => handleSelect(ch)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/8 ${
                isActive
                  ? 'bg-accent/15 border-l-2 border-accent'
                  : 'border-l-2 border-transparent'
              }`}
            >
              <div className="relative flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-surface-800 flex items-center justify-center">
                {artwork ? (
                  <LazyImage
                    src={artwork}
                    alt={ch.name}
                    className="h-full w-full"
                    fit="cover"
                  />
                ) : (
                  <Radio size={16} className="text-surface-500" />
                )}
                {isActive && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Play size={14} fill="white" color="white" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <ClampText
                  as="p"
                  lines={1}
                  className={`text-xs font-medium leading-4 ${isActive ? 'text-accent' : 'text-white'}`}
                >
                  {ch.name}
                </ClampText>
                {ch.categoryName && (
                  <ClampText as="p" lines={1} className="text-[10px] leading-3 text-surface-500 mt-0.5">
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
