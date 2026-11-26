import { ChevronDown, ChevronUp, FastForward, Rewind, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { PlayIcon } from '@/components/ui/icons'
import { useStore } from '@/store'
import { useAdjacentChannels } from '@/hooks/useAdjacentChannels'
import { adjacentEpisodes } from '@/store/player-slice'
import { strings } from '@/strings'
import { PlayerRange } from './PlayerRange'
import { CONTROL_SIZE, roundButton, useDockLayout, type DockSize } from './player-ui'

const text = strings.player.transport


/** The one white control of the player: play / pause, a step larger than the round buttons beside it. */
const PLAY_SIZE: Record<DockSize, { round: string; glyph: number }> = {
  l: { round: 'size-[52px]', glyph: 24 },
  m: { round: 'size-[52px]', glyph: 24 },
  s: { round: 'size-[52px]', glyph: 24 },
  xs: { round: 'size-12', glyph: 22 }
}

function PauseGlyph({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4.5" height="14" rx="1.5" />
      <rect x="13.5" y="5" width="4.5" height="14" rx="1.5" />
    </svg>
  )
}

interface VolumeControlProps {
  isMuted: boolean
  volume: number
  onToggleMute: () => void
  onVolumeChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}

function VolumeControl({ isMuted, volume, onToggleMute, onVolumeChange }: VolumeControlProps) {
  const { size } = useDockLayout()
  const muteLabel = isMuted ? text.unmute : text.mute

  return (
    <div className="ml-1 flex items-center gap-1.5">
      <button
        type="button"
        onClick={onToggleMute}
        className={`flex ${CONTROL_SIZE[size].round} shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-raised`}
        title={muteLabel}
        aria-label={muteLabel}
      >
        {isMuted || volume === 0 ? (
          <VolumeX size={CONTROL_SIZE[size].icon} strokeWidth={2.4} aria-hidden="true" />
        ) : (
          <Volume2 size={CONTROL_SIZE[size].icon} strokeWidth={2.4} aria-hidden="true" />
        )}
      </button>
      {/* In the narrowest dock the mute button (and the arrow keys) stay; the slider goes. */}
      {size !== 'xs' && (
        <PlayerRange
          min={0}
          max={1}
          step={0.05}
          value={isMuted ? 0 : volume}
          onChange={onVolumeChange}
          className={size === 's' ? 'w-[88px]' : 'w-[104px]'}
          aria-label={text.volume}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((isMuted ? 0 : volume) * 100)}
        />
      )}
    </div>
  )
}

interface PlayerTransportControlsProps {
  /** Engine-specific actions stay with the parent, which owns the video ref. */
  onSeek: (seconds: number) => void
  onTogglePlay: () => void
  onToggleMute: () => void
  onVolumeChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * Left-hand cluster of the dock's controls row: previous / next item, the
 * seek steps of a film, play / pause, volume. The way back to the live edge
 * sits in the banner above, beside the "Canlı" mark it belongs to.
 *
 * Reads playback state straight from the store like the other player controls
 * rather than taking it as props — drilling a handful of booleans through the
 * parent only couples the two components' render cycles together.
 */
export function PlayerTransportControls({
  onSeek,
  onTogglePlay,
  onToggleMute,
  onVolumeChange
}: PlayerTransportControlsProps) {
  const currentChannel = useStore((s) => s.currentChannel)
  const isPlaying = useStore((s) => s.isPlaying)
  const isPaused = useStore((s) => s.isPaused)
  const isMuted = useStore((s) => s.isMuted)
  const volume = useStore((s) => s.volume)
  const playChannel = useStore((s) => s.playChannel)
  const seekStep = useStore((s) => s.settings.seekStepSeconds)
  const seekBackLabel = text.seekBack(seekStep)
  const seekForwardLabel = text.seekForward(seekStep)
  const playEpisode = useStore((s) => s.playEpisode)
  const episodeTarget = useStore((s) => (s.currentPlayback?.target.kind === 'episode' ? s.currentPlayback.target : null))
  const episodeQueue = useStore((s) => s.episodeQueue)
  const { size } = useDockLayout()

  const channels = useAdjacentChannels(currentChannel)
  // An episode steps through its series, not through the film list it is shown as.
  const episodes = adjacentEpisodes(episodeQueue, episodeTarget)
  const previous = episodeTarget ? episodes.previous : channels.previous
  const next = episodeTarget ? episodes.next : channels.next

  const isLive = currentChannel?.type === 'live'

  const playAdjacent = (direction: 'prev' | 'next') => {
    if (episodeTarget) {
      const episode = direction === 'prev' ? episodes.previous : episodes.next
      if (episode) playEpisode(episode)
      return
    }
    const target = direction === 'prev' ? channels.previous : channels.next
    if (target) playChannel(target)
  }

  const previousLabel = previous ? text.previous('title' in previous ? previous.title : previous.name) : text.noPrevious
  const nextLabel = next ? text.next('title' in next ? next.title : next.name) : text.noNext
  const showsPlay = isPaused || !isPlaying
  const playLabel = showsPlay ? text.play : text.pause
  const icon = CONTROL_SIZE[size].icon
  // Live channels step up and down a list; films skip back and forth.
  const PreviousIcon = isLive ? ChevronUp : SkipBack
  const NextIcon = isLive ? ChevronDown : SkipForward

  // Labelled where the dock has room; the accessible name always names the item.
  const stepClass =
    size === 'l'
      ? `flex ${CONTROL_SIZE[size].height} shrink-0 items-center gap-2 rounded-full bg-raised pl-3.5 pr-5 text-[15px] font-bold text-white transition-colors hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-raised`
      : roundButton(size)

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => playAdjacent('prev')}
        disabled={!previous}
        className={stepClass}
        title={previousLabel}
        aria-label={previousLabel}
      >
        <PreviousIcon size={icon} strokeWidth={2.8} aria-hidden="true" />
        {size === 'l' && <span>{text.previousShort}</span>}
      </button>

      {!isLive && (
        <button type="button" onClick={() => onSeek(-seekStep)} className={roundButton(size)} title={seekBackLabel} aria-label={seekBackLabel}>
          <Rewind size={icon} strokeWidth={2.4} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        onClick={onTogglePlay}
        className={`mx-1 flex ${PLAY_SIZE[size].round} shrink-0 items-center justify-center rounded-full bg-white text-ink transition-colors hover:bg-surface-300`}
        title={text.playPauseTitle}
        aria-label={playLabel}
      >
        {showsPlay ? <PlayIcon size={PLAY_SIZE[size].glyph} /> : <PauseGlyph size={PLAY_SIZE[size].glyph} />}
      </button>

      {!isLive && (
        <button type="button" onClick={() => onSeek(seekStep)} className={roundButton(size)} title={seekForwardLabel} aria-label={seekForwardLabel}>
          <FastForward size={icon} strokeWidth={2.4} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        onClick={() => playAdjacent('next')}
        disabled={!next}
        className={stepClass}
        title={nextLabel}
        aria-label={nextLabel}
      >
        <NextIcon size={icon} strokeWidth={2.8} aria-hidden="true" />
        {size === 'l' && <span>{text.nextShort}</span>}
      </button>

      <VolumeControl
        isMuted={isMuted}
        volume={volume}
        onToggleMute={onToggleMute}
        onVolumeChange={onVolumeChange}
      />
    </div>
  )
}
