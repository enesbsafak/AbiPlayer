import { useRef, useEffect, useCallback, useMemo, useState, type MouseEvent } from 'react'
import { useStore } from '@/store'
import { usePlayer } from '@/hooks/usePlayer'
import { useMpvPlayer, type MpvPlayerOptions } from '@/hooks/useMpvPlayer'
import { shouldKeepPlayingInCorner } from '@/store/player-slice'
import { useKeepDisplayAwake } from '@/hooks/useKeepDisplayAwake'
import { useControlsAutoHide } from '@/hooks/useControlsAutoHide'
import { useDockClearance } from '@/hooks/useDockClearance'
import { useResumePlayback } from '@/hooks/useResumePlayback'
import { PlayerControls, formatTime } from './PlayerControls'
import { PlayerSidebar, SIDEBAR_WIDTH } from './PlayerSidebar'
import { SubtitleOverlay } from './SubtitleOverlay'
import { OVER_VIDEO } from './player-ui'
import { Spinner } from '@/components/ui/Spinner'
import { CloseIcon } from '@/components/ui/icons'
import { AlertCircle, Info, RefreshCw, RotateCcw } from 'lucide-react'
import { mpvIsAvailable, mpvSetFullscreen, mpvSetSubtitleInset, windowSetFullscreen } from '@/services/platform'
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
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [dock, setDock] = useState<HTMLElement | null>(null)
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
    setContainer(node)
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

  const autoHide = useControlsAutoHide({
    setVisible: setShowControls,
    isSidebarOpen: isPlayerSidebarOpen,
    hasError: playerError !== null
  })
  const controlsVisible = showControls || isPlayerSidebarOpen

  // Subtitles sit above the controls while those are shown. The page's own
  // subtitles are placed here; mpv's are lifted in main, against the window.
  const dockClearance = useDockClearance(container, dock)
  const mpvSubtitleInset = mpvEnabled && controlsVisible ? dockClearance.inWindow : 0
  useEffect(() => {
    if (!mpvEnabled) return
    void mpvSetSubtitleInset(mpvSubtitleInset).catch(() => undefined)
    // The window height is a dependency: main turns the inset into a share of it.
  }, [mpvEnabled, mpvSubtitleInset, dockClearance.windowHeight])
  useEffect(() => {
    if (!mpvEnabled) return
    // Leaving the player (or mpv) puts them back; the corner player has no controls.
    return () => void mpvSetSubtitleInset(0).catch(() => undefined)
  }, [mpvEnabled])

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
      className={`relative overflow-hidden ${mpvEnabled ? '' : 'bg-black'} ${controlsVisible ? '' : 'cursor-none'} ${className}`}
      onMouseMove={autoHide.onMouseMove}
      onMouseLeave={autoHide.onMouseLeave}
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

      {/* Over the picture (mpv draws it in a native layer underneath), only
          flat, nearly opaque surfaces: no blur, shade or gradient. */}
      {showLoadingOverlay && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={`flex size-24 items-center justify-center rounded-full ${OVER_VIDEO}`}>
            <Spinner size={44} />
          </div>
        </div>
      )}

      {playerError && (
        <div className="absolute inset-0 flex items-center justify-center bg-deep/80 p-6">
          <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-tile bg-ground px-8 pb-7 pt-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-[18px] bg-coral text-ink">
              <AlertCircle size={30} strokeWidth={2.6} aria-hidden="true" />
            </span>
            <p data-player-error-message className="text-[16px] font-medium leading-6 text-white">
              {playerError}
            </p>
            {currentChannel && (
              <button
                type="button"
                onClick={() => useStore.getState().reloadPlayback()}
                className="mt-1 flex h-[52px] items-center gap-2.5 rounded-full bg-white px-6 text-[16px] font-bold text-ink transition-colors hover:bg-surface-300"
              >
                <RefreshCw size={18} strokeWidth={2.6} aria-hidden="true" />
                {strings.player.reconnect}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Below the top row of the controls, centred over the picture (left of the list when it is open). */}
      <div
        className="pointer-events-none absolute left-4 top-[76px] flex flex-col items-center gap-2 short:top-[68px]"
        style={{ right: (isPlayerSidebarOpen ? SIDEBAR_WIDTH : 0) + 16 }}
      >
        {resumedFrom !== null && (
          <div className={`pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-[30px] py-2 pl-5 pr-2 text-[16px] font-medium text-white ${OVER_VIDEO}`}>
            <span>{strings.player.resumedFrom(formatTime(resumedFrom))}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={restartFromStart}
                className="flex h-11 items-center gap-2 rounded-full border-2 border-white/50 px-4 text-[15px] font-bold transition-colors hover:border-white"
              >
                <RotateCcw size={16} strokeWidth={2.6} aria-hidden="true" />
                {strings.player.restartFromStart}
              </button>
              <button
                type="button"
                onClick={dismissResumeNotice}
                aria-label={strings.common.dismissNotice}
                className="flex size-11 items-center justify-center rounded-full bg-raised transition-colors hover:bg-surface-800"
              >
                <CloseIcon size={16} />
              </button>
            </div>
          </div>
        )}

        {playerNotice && (
          <div
            role="status"
            className={`pointer-events-auto flex max-w-full items-center gap-3 rounded-[30px] py-2 pl-5 pr-2 text-[16px] font-medium text-white ${OVER_VIDEO}`}
          >
            <Info size={20} strokeWidth={2.6} className="shrink-0 text-sun" aria-hidden="true" />
            <span className="min-w-0">{playerNotice}</span>
            <button
              type="button"
              onClick={() => useStore.getState().setPlayerNotice(null)}
              aria-label={strings.common.dismissNotice}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-raised transition-colors hover:bg-surface-800"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        )}
      </div>

      <SubtitleOverlay playerSize={playerSize} dockClearance={controlsVisible ? dockClearance.inPlayer : 0} />

      <PlayerSidebar />

      {/* Hidden, the controls take no clicks (they fall through to the picture)
          but stay focusable: focus moving into them by keyboard shows them. */}
      <div
        ref={autoHide.controlsRef}
        data-controls-visible={controlsVisible}
        onFocus={autoHide.onControlsFocus}
        onBlur={autoHide.onControlsBlur}
        className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0 [&_*]:!pointer-events-none'}`}
      >
        <PlayerControls
          videoRef={videoRef}
          onToggleFullscreen={toggleFullscreenDetached}
          onDockChange={setDock}
        />
      </div>
    </div>
  )
}
