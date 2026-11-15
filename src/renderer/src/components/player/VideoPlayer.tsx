import { useRef, useEffect, useCallback, useMemo, useState, type MouseEvent } from 'react'
import { useStore } from '@/store'
import { usePlayer } from '@/hooks/usePlayer'
import { useMpvPlayer, type MpvPlayerOptions } from '@/hooks/useMpvPlayer'
import { shouldKeepPlayingInCorner } from '@/store/player-slice'
import { useKeepDisplayAwake } from '@/hooks/useKeepDisplayAwake'
import { useResumePlayback } from '@/hooks/useResumePlayback'
import { PlayerControls, formatTime } from './PlayerControls'
import { PlayerSidebar } from './PlayerSidebar'
import { SubtitleOverlay } from './SubtitleOverlay'
import { Spinner } from '@/components/ui/Spinner'
import { AlertCircle, Info, RefreshCw, RotateCcw, X } from 'lucide-react'
import { mpvIsAvailable, mpvSetFullscreen, windowSetFullscreen } from '@/services/platform'
import { GENERATED_CAPTIONS_TRACK_LABEL, GENERATED_CAPTIONS_TRACK_LANGUAGE } from '@/constants/captions'
import type { SubtitleCue } from '@/types/player'
import { perfMark, usePerfTransition } from '@/services/perf'
import { strings } from '@/strings'

interface VideoPlayerProps {
  className?: string
}

const DEFAULT_PLAYER_SIZE = { width: 1280, height: 720 }

// Leaving the route with the experimental corner setting on hands mpv to the
// corner player instead of stopping it (the same decision the store makes).
const MPV_ROUTE_HOST: MpvPlayerOptions = {
  keepPlayingOnUnmount: () => shouldKeepPlayingInCorner(useStore.getState())
}
const PLAYER_NOTICE_MS = 8_000

function formatVttTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const totalMilliseconds = Math.round(safeSeconds * 1000)
  const milliseconds = totalMilliseconds % 1000
  const totalSeconds = Math.floor(totalMilliseconds / 1000)
  const secs = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`
}

function buildCaptionsTrackSrc(cues: SubtitleCue[]): string {
  const body = cues
    .map((cue, index) => {
      const start = formatVttTime(cue.startTime)
      const end = formatVttTime(Math.max(cue.endTime, cue.startTime + 0.001))
      const text = cue.text.replace(/\r\n?/g, '\n').replaceAll('-->', '-- >')
      return `${index + 1}\n${start} --> ${end}\n${text}`
    })
    .join('\n\n')

  return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n${body}`)}`
}

export function VideoPlayer({ className = '' }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>()
  // `null` = detection still running. Neither engine may touch the stream until
  // this settles, otherwise HTML5 opens the URL and MPV immediately opens it a
  // second time — providers count that against their max-connection limit.
  const [mpvAvailable, setMpvAvailable] = useState<boolean | null>(null)
  const [playerSize, setPlayerSize] = useState(DEFAULT_PLAYER_SIZE)

  const currentChannel = useStore((s) => s.currentChannel)
  const isBuffering = useStore((s) => s.isBuffering)
  const playerError = useStore((s) => s.playerError)
  const showControls = useStore((s) => s.showControls)
  const playbackEngine = useStore((s) => s.playbackEngine)
  const setShowControls = useStore((s) => s.setShowControls)
  const isFullscreen = useStore((s) => s.isFullscreen)
  const setFullscreen = useStore((s) => s.setFullscreen)
  const setPlaybackEngine = useStore((s) => s.setPlaybackEngine)
  const isPlayerSidebarOpen = useStore((s) => s.isPlayerSidebarOpen)
  const subtitleCues = useStore((s) => s.subtitleCues)
  const playerNotice = useStore((s) => s.playerNotice)
  const isEngineResolved = mpvAvailable !== null
  const mpvEnabled = mpvAvailable === true && playbackEngine === 'mpv'
  const captionsTrackSrc = useMemo(() => buildCaptionsTrackSrc(subtitleCues), [subtitleCues])

  usePlayer(videoRef, { disabled: mpvEnabled || !isEngineResolved })
  const isMpvStarting = useMpvPlayer(mpvEnabled, MPV_ROUTE_HOST)
  useKeepDisplayAwake()
  const { resumedFrom, dismissResumeNotice, restartFromStart } = useResumePlayback(
    videoRef,
    mpvEnabled,
    isEngineResolved
  )
  // MPV handles buffering natively — only show overlay on initial startup or HTML5 buffering
  const showLoadingOverlay = !isEngineResolved || (mpvEnabled ? isMpvStarting : isBuffering)
  usePerfTransition('player:overlay-hidden', !showLoadingOverlay)

  useEffect(() => {
    let cancelled = false
    const detectMpv = async () => {
      const available = await mpvIsAvailable().catch(() => false)
      if (cancelled) return
      // Publish the engine before lifting the gate, so no render can ever see
      // "detection finished" while the engine still reads html5.
      setPlaybackEngine(available ? 'mpv' : 'html5')
      setMpvAvailable(available)
      perfMark('player:engine-resolved', { engine: available ? 'mpv' : 'html5' })
    }

    void detectMpv()
    return () => {
      cancelled = true
    }
  }, [setPlaybackEngine])

  const syncContainerSize = useCallback((container: HTMLDivElement) => {
    const rect = container.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    setPlayerSize((prev) => {
      if (prev.width === width && prev.height === height) return prev
      return { width, height }
    })
  }, [])

  const setContainerNode = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    if (node) syncContainerSize(node)
  }, [syncContainerSize])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let rafId = 0
    const syncSize = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => syncContainerSize(container))
    }

    const resizeObserver = new ResizeObserver(syncSize)
    resizeObserver.observe(container)
    window.addEventListener('resize', syncSize)

    return () => {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      window.removeEventListener('resize', syncSize)
    }
  }, [syncContainerSize])

  const handleMouseMove = useCallback(() => {
    setShowControls(true)
    clearTimeout(hideTimerRef.current)
    if (!isPlayerSidebarOpen) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 3000)
    }
  }, [setShowControls, isPlayerSidebarOpen])

  useEffect(() => () => clearTimeout(hideTimerRef.current), [])

  useEffect(() => {
    if (!playerNotice) return
    const timer = window.setTimeout(() => useStore.getState().setPlayerNotice(null), PLAYER_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [playerNotice])

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

  // The browser may refuse fullscreen (no user gesture, a policy); nothing changes then.
  const toggleFullscreenDetached = useCallback(() => {
    void toggleFullscreen().catch(() => undefined)
  }, [toggleFullscreen])

  const handleContainerDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (!target) return
    if (target.closest('[data-player-controls]') || target.closest('[data-player-sidebar]')) return
    toggleFullscreenDetached()
  }, [toggleFullscreenDetached])

  useEffect(() => {
    if (mpvEnabled) return
    const handler = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [mpvEnabled, setFullscreen])

  if (!currentChannel) return null

  return (
    <div
      ref={setContainerNode}
      data-player-container
      className={`relative overflow-hidden ${mpvEnabled ? '' : 'bg-black'} ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { if (!isPlayerSidebarOpen) setShowControls(false) }}
      onDoubleClick={handleContainerDoubleClick}
    >
      {mpvEnabled ? (
        <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.004)' }} />
      ) : (
        <video
          ref={videoRef}
          aria-label={strings.player.videoLabel(currentChannel.name)}
          className="h-full w-full"
          playsInline
        >
          <track
            kind="captions"
            src={captionsTrackSrc}
            srcLang={GENERATED_CAPTIONS_TRACK_LANGUAGE}
            label={GENERATED_CAPTIONS_TRACK_LABEL}
          />
        </video>
      )}

      {showLoadingOverlay && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Spinner size={48} />
        </div>
      )}

      {playerError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3">
          <AlertCircle size={48} className="text-red-400" />
          <p className="text-sm text-red-400 text-center max-w-md">{playerError}</p>
          {currentChannel && (
            <button
              type="button"
              onClick={() => useStore.getState().reloadPlayback()}
              className="mt-2 flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition-colors"
            >
              <RefreshCw size={14} />
              {strings.player.reconnect}
            </button>
          )}
        </div>
      )}

      <div className="absolute left-1/2 top-6 flex -translate-x-1/2 flex-col items-center gap-2">
        {resumedFrom !== null && (
          <div className="flex items-center gap-3 rounded-lg border border-surface-700 bg-surface-950/95 px-4 py-2.5 text-sm text-surface-200 shadow-lg">
            <span>{strings.player.resumedFrom(formatTime(resumedFrom))}</span>
            <button
              type="button"
              onClick={restartFromStart}
              className="flex items-center gap-1.5 rounded-md border border-surface-700 px-2.5 py-1 text-xs text-surface-300 transition-colors hover:border-surface-600 hover:text-surface-50"
            >
              <RotateCcw size={13} />
              {strings.player.restartFromStart}
            </button>
            <button
              type="button"
              onClick={dismissResumeNotice}
              aria-label={strings.common.dismissNotice}
              className="text-surface-500 transition-colors hover:text-surface-200"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {playerNotice && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-lg border border-surface-700 bg-surface-950/95 px-4 py-2.5 text-sm text-surface-200 shadow-lg"
          >
            <Info size={14} className="shrink-0 text-surface-400" aria-hidden="true" />
            <span>{playerNotice}</span>
            <button
              type="button"
              onClick={() => useStore.getState().setPlayerNotice(null)}
              aria-label={strings.common.dismissNotice}
              className="text-surface-500 transition-colors hover:text-surface-200"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      <SubtitleOverlay playerSize={playerSize} />

      <PlayerSidebar />

      <div className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 ${showControls || isPlayerSidebarOpen ? 'opacity-100' : 'opacity-0'}`}>
        <PlayerControls
          videoRef={videoRef}
          onToggleFullscreen={toggleFullscreenDetached}
        />
      </div>
    </div>
  )
}
