import { ArrowLeft, FastForward, Pause, Play, Rewind, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { useStore } from '@/store'
import { useAdjacentChannels } from '@/hooks/useAdjacentChannels'

const ICON_BUTTON = 'rounded-lg p-2 transition-colors duration-normal hover:bg-white/10'
const ICON_BUTTON_SKIP = `${ICON_BUTTON} disabled:cursor-not-allowed disabled:opacity-35`

const SEEK_BACK_LABEL = '10 saniye geri sar'
const SEEK_FORWARD_LABEL = '10 saniye ileri sar'

interface VolumeControlProps {
  isMuted: boolean
  volume: number
  onToggleMute: () => void
  onVolumeChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}

function VolumeControl({ isMuted, volume, onToggleMute, onVolumeChange }: VolumeControlProps) {
  const muteLabel = isMuted ? 'Sesi Aç' : 'Sesi Kapat'

  return (
    <div className="ml-2 flex items-center gap-1">
      <button type="button" onClick={onToggleMute} className={ICON_BUTTON} title={muteLabel} aria-label={muteLabel}>
        {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={isMuted ? 0 : volume}
        onChange={onVolumeChange}
        className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-surface-600 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        aria-label="Ses seviyesi"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((isMuted ? 0 : volume) * 100)}
      />
    </div>
  )
}

interface PlayerTransportControlsProps {
  /** Engine-specific actions stay with the parent, which owns the video ref. */
  onLeave: () => void
  onSeek: (seconds: number) => void
  onTogglePlay: () => void
  onJumpToLive: () => void
  onToggleMute: () => void
  onVolumeChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * Left-hand cluster: navigation, playback transport, live edge, volume.
 *
 * Reads playback state straight from the store like the other player controls
 * rather than taking it as props — drilling a handful of booleans through the
 * parent only couples the two components' render cycles together.
 */
export function PlayerTransportControls({
  onLeave,
  onSeek,
  onTogglePlay,
  onJumpToLive,
  onToggleMute,
  onVolumeChange
}: PlayerTransportControlsProps) {
  const currentChannel = useStore((s) => s.currentChannel)
  const isPlaying = useStore((s) => s.isPlaying)
  const isPaused = useStore((s) => s.isPaused)
  const isBuffering = useStore((s) => s.isBuffering)
  const isMuted = useStore((s) => s.isMuted)
  const volume = useStore((s) => s.volume)
  const playChannel = useStore((s) => s.playChannel)

  const { previous: previousChannel, next: nextChannel } = useAdjacentChannels(currentChannel)

  const isLive = currentChannel?.type === 'live'
  // "Behind live": the user paused (the gap grows while paused) or the engine is
  // stalled and will resume behind the edge. Deliberately not derived from the
  // demuxer cache size, which doesn't map cleanly to drift during steady play.
  const isBehindLive = isPaused || isBuffering

  const playAdjacent = (direction: 'prev' | 'next') => {
    const target = direction === 'prev' ? previousChannel : nextChannel
    if (target) playChannel(target)
  }

  const previousLabel = previousChannel ? `Önceki: ${previousChannel.name}` : 'Önceki içerik yok'
  const nextLabel = nextChannel ? `Sonraki: ${nextChannel.name}` : 'Sonraki içerik yok'
  const playLabel = isPaused || !isPlaying ? 'Oynat' : 'Duraklat'
  const liveLabel = isBehindLive ? 'Canlıya dön' : 'Canlı yayındasın'

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onLeave} className={ICON_BUTTON} title="Geri dön" aria-label="Geri dön">
        <ArrowLeft size={18} />
      </button>

      <button
        type="button"
        onClick={() => playAdjacent('prev')}
        disabled={!previousChannel}
        className={ICON_BUTTON_SKIP}
        title={previousLabel}
        aria-label={previousLabel}
      >
        <SkipBack size={18} />
      </button>

      {!isLive && (
        <button type="button" onClick={() => onSeek(-10)} className={ICON_BUTTON} title={SEEK_BACK_LABEL} aria-label={SEEK_BACK_LABEL}>
          <Rewind size={18} />
        </button>
      )}

      <button type="button" onClick={onTogglePlay} className={ICON_BUTTON} title="Oynat/Duraklat" aria-label={playLabel}>
        {isPaused || !isPlaying ? <Play size={22} fill="white" /> : <Pause size={22} fill="white" />}
      </button>

      {!isLive && (
        <button type="button" onClick={() => onSeek(10)} className={ICON_BUTTON} title={SEEK_FORWARD_LABEL} aria-label={SEEK_FORWARD_LABEL}>
          <FastForward size={18} />
        </button>
      )}

      <button
        type="button"
        onClick={() => playAdjacent('next')}
        disabled={!nextChannel}
        className={ICON_BUTTON_SKIP}
        title={nextLabel}
        aria-label={nextLabel}
      >
        <SkipForward size={18} />
      </button>

      {isLive && (
        <button
          type="button"
          onClick={onJumpToLive}
          className={`ml-1 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-normal ${
            isBehindLive
              ? 'border border-white/50 text-white hover:bg-white/10'
              : 'bg-red-600 text-white hover:bg-red-500'
          }`}
          title={liveLabel}
          aria-label={liveLabel}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${isBehindLive ? 'bg-white/70' : 'bg-white'}`} />
          CANLI
        </button>
      )}

      <VolumeControl
        isMuted={isMuted}
        volume={volume}
        onToggleMute={onToggleMute}
        onVolumeChange={onVolumeChange}
      />

      {currentChannel && (
        <span className="ml-4 max-w-[240px] truncate text-sm font-medium" title={currentChannel.name}>
          {currentChannel.name}
        </span>
      )}
    </div>
  )
}
