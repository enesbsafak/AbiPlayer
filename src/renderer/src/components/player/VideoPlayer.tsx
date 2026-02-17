import { useRef, useEffect, useCallback, useState, type MouseEvent } from 'react'
import { useStore } from '@/store'
import { usePlayer } from '@/hooks/usePlayer'
import { useMpvPlayer } from '@/hooks/useMpvPlayer'
import { PlayerControls } from './PlayerControls'
import { SubtitleOverlay } from './SubtitleOverlay'
import { Spinner } from '@/components/ui/Spinner'
import { AlertCircle } from 'lucide-react'
import { mpvIsAvailable, mpvSetFullscreen, windowSetFullscreen } from '@/services/platform'

interface VideoPlayerProps {
  className?: string
}

export function VideoPlayer({ className = '' }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const [mpvAvailable, setMpvAvailable] = useState(false)

  const {
    currentChannel, isBuffering, playerError, showControls,
    playbackEngine, setShowControls, isFullscreen, setFullscreen, setPlaybackEngine
  } = useStore()
  const mpvEnabled = mpvAvailable && playbackEngine === 'mpv'

  usePlayer(videoRef, { disabled: mpvEnabled })
  useMpvPlayer(mpvEnabled)

  useEffect(() => {
    let cancelled = false
    const detectMpv = async () => {
      const available = await mpvIsAvailable().catch(() => false)
      if (cancelled) return
      setMpvAvailable(available)
      setPlaybackEngine(available ? 'mpv' : 'html5')
    }

    void detectMpv()
    return () => {
      cancelled = true
    }
  }, [setPlaybackEngine])

  const handleMouseMove = useCallback(() => {
    setShowControls(true)
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setShowControls(false), 3000)
  }, [setShowControls])

  const toggleFullscreen = useCallback(async () => {
    if (mpvEnabled) {
      const next = !isFullscreen
      await Promise.allSettled([windowSetFullscreen(next), mpvSetFullscreen(next)])
      setFullscreen(next)
      return
    }

    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen()
      setFullscreen(true)
    } else {
      await document.exitFullscreen()
      setFullscreen(false)
    }
  }, [isFullscreen, mpvEnabled, setFullscreen])

  const handleContainerDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (!target) return
    if (target.closest('[data-player-controls]')) return
    void toggleFullscreen()
  }, [toggleFullscreen])

  useEffect(() => {
    if (mpvEnabled) return
    const handler = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [mpvEnabled, setFullscreen])

  if (!currentChannel) return null

  return (
    <div
      ref={containerRef}
      data-player-container
      className={`relative overflow-hidden ${mpvEnabled ? '' : 'bg-black'} ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowControls(false)}
      onDoubleClick={handleContainerDoubleClick}
    >
      {mpvEnabled ? (
        <div className="absolute inset-0 pointer-events-none" />
      ) : (
        <video
          ref={videoRef}
          className="h-full w-full"
          playsInline
          autoPlay
        />
      )}

      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Spinner size={48} />
        </div>
      )}

      {playerError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3">
          <AlertCircle size={48} className="text-red-400" />
          <p className="text-sm text-red-400 text-center max-w-md">{playerError}</p>
        </div>
      )}

      <SubtitleOverlay />

      <div className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <PlayerControls
          videoRef={videoRef}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>
    </div>
  )
}
