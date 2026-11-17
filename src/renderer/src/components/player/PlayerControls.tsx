import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState, type RefObject } from 'react'
import { ArrowLeftIcon } from '@/components/ui/icons'
import { useStore } from '@/store'
import { PlayerActionControls } from './PlayerActionControls'
import { PlayerTransportControls } from './PlayerTransportControls'
import { LiveBanner, MediaBanner } from './PlayerBanner'
import { SIDEBAR_WIDTH } from './PlayerSidebar'
import { useAddonStreamChoice } from './addon-stream-choice'
import { DockLayoutContext, OVER_VIDEO, dockSizeFor, playerTone, useElementWidth } from './player-ui'
import { navigateToPlayerReturnTarget } from '@/services/player-navigation'
import { AUTO_VIDEO_QUALITY_ID, inferContentQualityLabel } from '@/services/quality'
import {
  mpvSeek,
  mpvJumpToLive,
  mpvSetFullscreen,
  mpvSetMute as mpvSetMuteCommand,
  mpvSetVolume as mpvSetVolumeCommand,
  mpvTogglePause,
  windowSetFullscreen
} from '@/services/platform'
import { toUserMessage } from '@/services/user-error'
import { strings } from '@/strings'

export { formatTime } from './player-ui'

const text = strings.player
const dockText = strings.player.dock

interface PlayerControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>
  onToggleFullscreen: () => void
  /** The dock element as it mounts and unmounts: subtitles are kept clear of it. */
  onDockChange?: (dock: HTMLElement | null) => void
}

/** The dock is centred and stops growing past this: about 1.2 × its designed width. */
const COLUMN = 'pointer-events-auto mx-auto w-full max-w-[1480px]'

/**
 * The stream's resolution, as the renderer knows it: the quality the engine
 * plays (or the one picked), else the label the item's name carries (what
 * the cards' quality badge shows). Nothing when neither says anything.
 */
function useStreamBadge(): string | null {
  const currentChannel = useStore((s) => s.currentChannel)
  const options = useStore((s) => s.videoQualityOptions)
  const current = useStore((s) => s.currentVideoQuality)
  const active = useStore((s) => s.activeVideoQuality)
  const playing = options.find((option) => option.id === (current === AUTO_VIDEO_QUALITY_ID ? active : current))
  if (playing?.height) return playing.shortLabel
  return inferContentQualityLabel(currentChannel)
}

export function PlayerControls({ videoRef, onToggleFullscreen, onDockChange }: PlayerControlsProps) {
  const navigate = useNavigate()
  // Select individually — a bare `useStore()` re-renders these controls on
  // every store write, and playback pushes time updates several times a second.
  const isPaused = useStore((s) => s.isPaused)
  const duration = useStore((s) => s.duration)
  const isMuted = useStore((s) => s.isMuted)
  const isFullscreen = useStore((s) => s.isFullscreen)
  const currentChannel = useStore((s) => s.currentChannel)
  const currentPlayback = useStore((s) => s.currentPlayback)
  const playbackEngine = useStore((s) => s.playbackEngine)
  const playerReturnTarget = useStore((s) => s.playerReturnTarget)
  const isPlayerSidebarOpen = useStore((s) => s.isPlayerSidebarOpen)
  const setVolume = useStore((s) => s.setVolume)
  const setMuted = useStore((s) => s.setMuted)
  const setPiP = useStore((s) => s.setPiP)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const setPlayerError = useStore((s) => s.setPlayerError)
  const badge = useStreamBadge()
  // Which pickers draw themselves (each hides when there is nothing to pick).
  const hasAudioPicker = useStore((s) => s.audioTracks.length > 1)
  const hasQualityPicker = useStore((s) => s.videoQualityOptions.length > 0)
  const hasAddonStreams = useAddonStreamChoice() !== null

  const [dock, setDock] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!onDockChange) return
    onDockChange(dock)
    return () => onDockChange(null)
  }, [dock, onDockChange])
  // The dock's padding is 14 px a side: its inner width, rounded down.
  const dockInnerWidth = Math.max(0, useElementWidth(dock) - 28)
  const isLive = currentChannel?.type === 'live'
  const isMpv = playbackEngine === 'mpv'
  const size = dockSizeFor(dockInnerWidth, {
    seeks: !isLive,
    // Subtitles are always there; tuning only on mpv; the add-on streams pill for an add-on item.
    pickers: 1 + (hasAudioPicker ? 1 : 0) + (hasQualityPicker ? 1 : 0) + (isMpv ? 1 : 0) + (hasAddonStreams ? 1 : 0),
    pip: !isMpv
  })
  const tone = playerTone(currentPlayback, currentChannel)
  const layout = useMemo(() => ({ size, tone }), [size, tone])

  const video = videoRef.current

  // A new load of the stream: main decides its TLS options again and may
  // refuse it (a certificate that changed since it was trusted).
  const jumpMpvToLive = () => {
    void mpvJumpToLive().catch((error: unknown) => setPlayerError(toUserMessage(error)))
  }

  const togglePlay = () => {
    if (playbackEngine === 'mpv') {
      if (currentChannel?.type === 'live' && isPaused) {
        jumpMpvToLive()
        return
      }
      void mpvTogglePause().catch(() => undefined)
      return
    }

    if (!video) return
    // A refused play() (autoplay policy, a source that failed) leaves it paused; the controls show that.
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }

  const seek = (seconds: number) => {
    if (playbackEngine === 'mpv') {
      if (!isFinite(duration) || duration === 0) return
      void mpvSeek(seconds).catch(() => undefined)
      return
    }

    if (!video || !isFinite(duration) || duration === 0) return
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + seconds))
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (playbackEngine === 'mpv') {
      void mpvSetVolumeCommand(v).catch(() => undefined)
    } else if (video) {
      video.volume = v
    }
    if (v > 0) setMuted(false)
  }

  const toggleMute = () => {
    const next = !isMuted
    setMuted(next)
    if (playbackEngine === 'mpv') {
      void mpvSetMuteCommand(next).catch(() => undefined)
      return
    }
    if (!video) return
    video.muted = next
  }

  const togglePiP = async () => {
    if (playbackEngine === 'mpv') return
    if (!video) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        setPiP(false)
      } else {
        await video.requestPictureInPicture()
        setPiP(true)
      }
    } catch {
      // Refused (no video frame yet, or picture-in-picture disabled): the state stays as it was.
    }
  }

  const navigateBackToOrigin = () => {
    navigateToPlayerReturnTarget({ navigate, target: playerReturnTarget })
  }

  const exitFullscreenIfNeeded = async () => {
    if (playbackEngine === 'mpv' && isFullscreen) {
      await Promise.allSettled([windowSetFullscreen(false), mpvSetFullscreen(false)])
    } else if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined)
    }
  }

  const leavePlayer = async () => {
    await exitFullscreenIfNeeded()
    setPiP(false)
    setMiniPlayer(true)
    navigateBackToOrigin()
  }

  const jumpToLive = () => {
    if (playbackEngine === 'mpv') {
      jumpMpvToLive()
      return
    }
    const el = videoRef.current
    if (!el) return
    const buf = el.buffered
    if (buf && buf.length > 0) {
      const end = buf.end(buf.length - 1)
      el.currentTime = Math.max(0, end - 0.3)
    }
    if (el.paused) el.play().catch(() => undefined)
  }

  return (
    <DockLayoutContext.Provider value={layout}>
      {/*
        Clicks between the two bands fall through to the picture (double-click
        for fullscreen). With the channel list open the column stops at its
        edge, so the dock stays whole beside it.
      */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 flex flex-col justify-between gap-3 p-4 short:p-3"
        style={{ right: isPlayerSidebarOpen ? SIDEBAR_WIDTH : 0 }}
      >
        {/* The top row spans the window: the way back stays at its top left at any size. */}
        <div data-player-controls className="flex w-full items-start gap-3" onDoubleClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={() => void leavePlayer()}
            className={`pointer-events-auto flex h-11 shrink-0 items-center gap-2 rounded-full pl-4 pr-5 text-[16px] font-bold text-white transition-colors hover:bg-raised ${OVER_VIDEO}`}
            title={text.actions.leaveTitle}
          >
            <ArrowLeftIcon size={20} />
            {text.actions.leaveLabel}
          </button>
          <div className="flex-1" />
          {badge && (
            <div role="group" aria-label={dockText.streamInfo} className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
              <span
                className={`flex h-9 items-center whitespace-nowrap rounded-full px-3.5 text-[15px] font-bold text-white ${OVER_VIDEO}`}
                title={strings.common.qualityTitle(badge)}
              >
                {badge}
              </span>
            </div>
          )}
        </div>

        <section
          ref={setDock}
          data-player-controls
          aria-label={dockText.label}
          className={`${COLUMN} flex flex-col gap-2 rounded-tile px-3.5 py-3 ${OVER_VIDEO}`}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {isLive ? <LiveBanner onJumpToLive={jumpToLive} /> : <MediaBanner video={video} />}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <PlayerTransportControls
              onSeek={seek}
              onTogglePlay={togglePlay}
              onToggleMute={toggleMute}
              onVolumeChange={handleVolumeChange}
            />
            <div className="min-w-0 flex-1" />
            <PlayerActionControls
              onTogglePiP={() => void togglePiP()}
              onToggleFullscreen={onToggleFullscreen}
            />
          </div>
        </section>
      </div>
    </DockLayoutContext.Provider>
  )
}
