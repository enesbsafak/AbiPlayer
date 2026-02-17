import { useRef, useEffect, useCallback } from 'react'
import { useStore } from '@/store'
import { usePlayer } from '@/hooks/usePlayer'
import { PlayerControls } from './PlayerControls'
import { SubtitleOverlay } from './SubtitleOverlay'
import { Spinner } from '@/components/ui/Spinner'
import { AlertCircle } from 'lucide-react'

interface VideoPlayerProps {
  className?: string
}

export function VideoPlayer({ className = '' }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const {
    currentChannel, isBuffering, playerError, showControls,
    setShowControls, isFullscreen, setFullscreen
  } = useStore()

  usePlayer(videoRef)

  const handleMouseMove = useCallback(() => {
    setShowControls(true)
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setShowControls(false), 3000)
  }, [setShowControls])

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen()
      setFullscreen(true)
    } else {
      await document.exitFullscreen()
      setFullscreen(false)
    }
  }, [setFullscreen])

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [setFullscreen])

  if (!currentChannel) return null

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowControls(false)}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        className="h-full w-full"
        playsInline
        autoPlay
      />

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
          containerRef={containerRef}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>
    </div>
  )
}
