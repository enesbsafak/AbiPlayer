import { useNavigate } from 'react-router-dom'
import { type RefObject, useMemo } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  Rewind, FastForward, SkipBack, SkipForward, PictureInPicture2, X
} from 'lucide-react'
import { useStore } from '@/store'
import { AudioTrackSelector } from './AudioTrackSelector'
import { SubtitleSelector } from './SubtitleSelector'
import { isPlayableChannel } from '@/services/playback'
import {
  mpvSeek,
  mpvSeekTo,
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

export function PlayerControls({ videoRef, onToggleFullscreen }: PlayerControlsProps) {
  const navigate = useNavigate()
  const {
    isPlaying, isPaused, currentTime, duration, volume, isMuted, isFullscreen,
    channels, currentChannel, playbackEngine,
    setVolume, setMuted, setPiP, stopPlayback, setMiniPlayer, playChannel
  } = useStore()

  const video = videoRef.current

  const togglePlay = () => {
    if (playbackEngine === 'mpv') {
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

  const exitPlayer = async () => {
    if (playbackEngine === 'mpv' && isFullscreen) {
      await Promise.allSettled([windowSetFullscreen(false), mpvSetFullscreen(false)])
    } else if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined)
    }

    setPiP(false)
    setMiniPlayer(false)
    stopPlayback()
    navigate('/')
  }

  const formatTime = (s: number) => {
    if (!isFinite(s)) return '--:--'
    const totalSeconds = Math.max(0, Math.floor(s))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const playlistCandidates = useMemo(() => {
    if (!currentChannel) return []
    return channels.filter((channel) =>
      channel.type === currentChannel.type &&
      channel.sourceId === currentChannel.sourceId &&
      isPlayableChannel(channel)
    )
  }, [channels, currentChannel])

  const currentIndex = useMemo(() => {
    if (!currentChannel) return -1
    return playlistCandidates.findIndex((item) => item.id === currentChannel.id)
  }, [playlistCandidates, currentChannel])

  const previousChannel = currentIndex > 0 ? playlistCandidates[currentIndex - 1] : null
  const nextChannel = currentIndex >= 0 && currentIndex < playlistCandidates.length - 1
    ? playlistCandidates[currentIndex + 1]
    : null

  const playAdjacent = (direction: 'prev' | 'next') => {
    const target = direction === 'prev' ? previousChannel : nextChannel
    if (!target) return
    playChannel(target)
  }

  const isLive = currentChannel?.type === 'live'
  const remainingTime = !isLive && duration > 0 ? Math.max(0, duration - currentTime) : 0
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const seekBackLabel = '10 saniye geri sar'
  const seekForwardLabel = '10 saniye ileri sar'

  const progressTrackColor = '#7c6af7'
  const progressBackColor = '#36364e'

  return (
    <div
      data-player-controls
      className="bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-12"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {!isLive && duration > 0 && (
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
            className="flex-1 h-1 appearance-none bg-surface-600 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
            style={{ background: `linear-gradient(to right, ${progressTrackColor} ${progress}%, ${progressBackColor} ${progress}%)` }}
          />
          <span className="text-xs text-surface-200 tabular-nums">{formatTime(duration)}</span>
          <span className="min-w-[70px] text-right text-xs text-surface-300 tabular-nums">
            -{formatTime(remainingTime)}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => playAdjacent('prev')}
            disabled={!previousChannel}
            className="rounded-lg p-2 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            title={previousChannel ? `Onceki: ${previousChannel.name}` : 'Onceki icerik yok'}
          >
            <SkipBack size={18} />
          </button>

          {!isLive && (
            <button onClick={() => seek(-10)} className="rounded-lg p-2 hover:bg-white/10 transition-colors" title={seekBackLabel}>
              <Rewind size={18} />
            </button>
          )}
          <button onClick={togglePlay} className="rounded-lg p-2 hover:bg-white/10 transition-colors" title="Oynat/Duraklat">
            {isPaused || !isPlaying ? <Play size={22} fill="white" /> : <Pause size={22} fill="white" />}
          </button>
          {!isLive && (
            <button onClick={() => seek(10)} className="rounded-lg p-2 hover:bg-white/10 transition-colors" title={seekForwardLabel}>
              <FastForward size={18} />
            </button>
          )}

          <button
            onClick={() => playAdjacent('next')}
            disabled={!nextChannel}
            className="rounded-lg p-2 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            title={nextChannel ? `Sonraki: ${nextChannel.name}` : 'Sonraki icerik yok'}
          >
            <SkipForward size={18} />
          </button>

          <div className="flex items-center gap-1 ml-2">
            <button onClick={toggleMute} className="rounded-lg p-2 hover:bg-white/10 transition-colors" title="Sesi Kapat">
              {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-20 h-1 appearance-none bg-surface-600 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            />
          </div>

          {currentChannel && (
            <span className="ml-4 text-sm font-medium truncate max-w-[240px]" title={currentChannel.name}>{currentChannel.name}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => void exitPlayer()} className="rounded-lg p-2 hover:bg-white/10 transition-colors" title="Oynaticidan cik (Esc)">
            <X size={18} />
          </button>
          <AudioTrackSelector />
          <SubtitleSelector />
          {playbackEngine !== 'mpv' && (
            <button onClick={togglePiP} className="rounded-lg p-2 hover:bg-white/10 transition-colors" title="Resim Icinde Resim">
              <PictureInPicture2 size={18} />
            </button>
          )}
          <button onClick={onToggleFullscreen} className="rounded-lg p-2 hover:bg-white/10 transition-colors" title="Tam Ekran (F)">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  )
}
