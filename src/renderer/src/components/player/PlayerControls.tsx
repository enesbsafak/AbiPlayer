import { type RefObject } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, PictureInPicture2
} from 'lucide-react'
import { useStore } from '@/store'
import { AudioTrackSelector } from './AudioTrackSelector'
import { SubtitleSelector } from './SubtitleSelector'

interface PlayerControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>
  containerRef: RefObject<HTMLDivElement | null>
  onToggleFullscreen: () => void
}

export function PlayerControls({ videoRef, containerRef, onToggleFullscreen }: PlayerControlsProps) {
  const {
    isPlaying, isPaused, currentTime, duration, volume, isMuted, isFullscreen,
    currentChannel, setVolume, setMuted, setPiP
  } = useStore()

  const video = videoRef.current

  const togglePlay = () => {
    if (!video) return
    if (video.paused) video.play()
    else video.pause()
  }

  const seek = (seconds: number) => {
    if (!video || !isFinite(duration) || duration === 0) return
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + seconds))
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (video) video.volume = v
    if (v > 0) setMuted(false)
  }

  const toggleMute = () => {
    if (!video) return
    const next = !isMuted
    setMuted(next)
    video.muted = next
  }

  const togglePiP = async () => {
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

  const formatTime = (s: number) => {
    if (!isFinite(s)) return '--:--'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const isLive = currentChannel?.type === 'live'
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-12">
      {/* Progress bar - only for VOD */}
      {!isLive && duration > 0 && (
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs text-surface-300 tabular-nums">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration}
            value={currentTime}
            onChange={(e) => {
              const t = parseFloat(e.target.value)
              if (video) video.currentTime = t
            }}
            className="flex-1 h-1 appearance-none bg-surface-600 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
            style={{ background: `linear-gradient(to right, #6366f1 ${progress}%, #495057 ${progress}%)` }}
          />
          <span className="text-xs text-surface-300 tabular-nums">{formatTime(duration)}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {!isLive && (
            <button onClick={() => seek(-10)} className="rounded-lg p-2 hover:bg-white/10 transition-colors">
              <SkipBack size={18} />
            </button>
          )}
          <button onClick={togglePlay} className="rounded-lg p-2 hover:bg-white/10 transition-colors">
            {isPaused || !isPlaying ? <Play size={22} fill="white" /> : <Pause size={22} fill="white" />}
          </button>
          {!isLive && (
            <button onClick={() => seek(10)} className="rounded-lg p-2 hover:bg-white/10 transition-colors">
              <SkipForward size={18} />
            </button>
          )}

          <div className="flex items-center gap-1 ml-2">
            <button onClick={toggleMute} className="rounded-lg p-2 hover:bg-white/10 transition-colors">
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
            <span className="ml-4 text-sm font-medium truncate max-w-[200px]">{currentChannel.name}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <AudioTrackSelector />
          <SubtitleSelector />
          <button onClick={togglePiP} className="rounded-lg p-2 hover:bg-white/10 transition-colors">
            <PictureInPicture2 size={18} />
          </button>
          <button onClick={onToggleFullscreen} className="rounded-lg p-2 hover:bg-white/10 transition-colors">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  )
}
