import { useNavigate } from 'react-router-dom'
import { type RefObject } from 'react'
import { useStore } from '@/store'
import { PlayerActionControls } from './PlayerActionControls'
import { PlayerTransportControls } from './PlayerTransportControls'
import { navigateToPlayerReturnTarget } from '@/services/player-navigation'
import {
  mpvSeek,
  mpvSeekTo,
  mpvJumpToLive,
  mpvSetFullscreen,
  mpvSetMute as mpvSetMuteCommand,
  mpvSetVolume as mpvSetVolumeCommand,
  mpvTogglePause,
  windowSetFullscreen
} from '@/services/platform'

interface PlayerControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>
  onToggleFullscreen: () => void
}

interface ProgressScrubberProps {
  currentTime: number
  duration: number
  remainingTime: number
  progress: number
  playbackEngine: string
  video: HTMLVideoElement | null
}

function formatTime(s: number) {
  if (!isFinite(s)) return '--:--'
  const totalSeconds = Math.max(0, Math.floor(s))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const PROGRESS_TRACK_COLOR = '#7c6af7'
const PROGRESS_BACK_COLOR = '#3f3f46'

function ProgressScrubber({
  currentTime,
  duration,
  remainingTime,
  progress,
  playbackEngine,
  video
}: ProgressScrubberProps) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="text-xs text-surface-200 tabular-nums">{formatTime(currentTime)}</span>
      <input
        type="range"
        min={0}
        max={duration}
        value={currentTime}
        onChange={(e) => {
          const t = parseFloat(e.target.value)
          if (playbackEngine === 'mpv') {
            void mpvSeekTo(t).catch(() => undefined)
          } else if (video) {
            video.currentTime = t
          }
        }}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-surface-600 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
        style={{ background: `linear-gradient(to right, ${PROGRESS_TRACK_COLOR} ${progress}%, ${PROGRESS_BACK_COLOR} ${progress}%)` }}
        aria-label="Oynatma ilerlemesi"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
      />
      <span className="text-xs text-surface-200 tabular-nums">{formatTime(duration)}</span>
      <span className="min-w-[70px] text-right text-xs text-surface-300 tabular-nums">
        -{formatTime(remainingTime)}
      </span>
    </div>
  )
}

export function PlayerControls({ videoRef, onToggleFullscreen }: PlayerControlsProps) {
  const navigate = useNavigate()
  // Select individually — a bare `useStore()` re-renders these controls on
  // every store write, and playback pushes time updates several times a second.
  const isPaused = useStore((s) => s.isPaused)
  const currentTime = useStore((s) => s.currentTime)
  const duration = useStore((s) => s.duration)
  const isMuted = useStore((s) => s.isMuted)
  const isFullscreen = useStore((s) => s.isFullscreen)
  const currentChannel = useStore((s) => s.currentChannel)
  const playbackEngine = useStore((s) => s.playbackEngine)
  const playerReturnTarget = useStore((s) => s.playerReturnTarget)
  const clearPlayerReturnTarget = useStore((s) => s.clearPlayerReturnTarget)
  const setVolume = useStore((s) => s.setVolume)
  const setMuted = useStore((s) => s.setMuted)
  const setPiP = useStore((s) => s.setPiP)
  const stopPlayback = useStore((s) => s.stopPlayback)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)

  const video = videoRef.current

  const togglePlay = () => {
    if (playbackEngine === 'mpv') {
      if (currentChannel?.type === 'live' && isPaused) {
        void mpvJumpToLive().catch(() => undefined)
        return
      }
      void mpvTogglePause().catch(() => undefined)
      return
    }

    if (!video) return
    if (video.paused) video.play()
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
    } catch {}
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

  const exitPlayer = async () => {
    await exitFullscreenIfNeeded()
    setPiP(false)
    setMiniPlayer(false)
    stopPlayback()
    clearPlayerReturnTarget()
    navigateBackToOrigin()
  }

  const isLive = currentChannel?.type === 'live'
  const remainingTime = !isLive && duration > 0 ? Math.max(0, duration - currentTime) : 0
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const jumpToLive = () => {
    if (playbackEngine === 'mpv') {
      void mpvJumpToLive().catch(() => undefined)
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
    <div
      data-player-controls
      className="bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-12"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {!isLive && duration > 0 && (
        <ProgressScrubber
          currentTime={currentTime}
          duration={duration}
          remainingTime={remainingTime}
          progress={progress}
          playbackEngine={playbackEngine}
          video={video}
        />
      )}

      <div className="flex items-center justify-between">
        <PlayerTransportControls
          onLeave={() => void leavePlayer()}
          onSeek={seek}
          onTogglePlay={togglePlay}
          onJumpToLive={jumpToLive}
          onToggleMute={toggleMute}
          onVolumeChange={handleVolumeChange}
        />

        <PlayerActionControls
          onExit={() => void exitPlayer()}
          onTogglePiP={() => void togglePiP()}
          onToggleFullscreen={onToggleFullscreen}
        />
      </div>
    </div>
  )
}
