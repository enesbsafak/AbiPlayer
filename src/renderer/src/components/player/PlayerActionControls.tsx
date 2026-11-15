import { List, Maximize, Minimize, PictureInPicture2 } from 'lucide-react'
import { useStore } from '@/store'
import { AudioTrackSelector } from './AudioTrackSelector'
import { PlaybackTuningSelector } from './PlaybackTuningSelector'
import { QualitySelector } from './QualitySelector'
import { SubtitleSelector } from './SubtitleSelector'
import { CONTROL_SIZE, filledClasses, roundButton, useDockLayout } from './player-ui'
import { strings } from '@/strings'

const text = strings.player.actions

interface PlayerActionControlsProps {
  /** Both need the video element / fullscreen coordination the parent owns. */
  onTogglePiP: () => void
  onToggleFullscreen: () => void
}

/**
 * Right-hand cluster of the dock's controls row: the track, quality and
 * tuning pickers (each a pill saying what it is set to), the channel list and
 * fullscreen. Reads its own state from the store, like the selectors it
 * renders. The way back is the labelled pill at the top left of the player.
 *
 * There is deliberately no "stop and exit" button. It used to sit next to the
 * back arrow looking like a second way out, while actually doing something
 * else (ending playback instead of minimising it) — a distinction the two icons
 * could not convey. Stopping now lives on the mini player, where it reads as
 * "close this".
 */
export function PlayerActionControls({ onTogglePiP, onToggleFullscreen }: PlayerActionControlsProps) {
  const playbackEngine = useStore((s) => s.playbackEngine)
  const isFullscreen = useStore((s) => s.isFullscreen)
  const isPlayerSidebarOpen = useStore((s) => s.isPlayerSidebarOpen)
  const onToggleSidebar = useStore((s) => s.togglePlayerSidebar)
  const { size, tone } = useDockLayout()
  const icon = CONTROL_SIZE[size].icon

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <AudioTrackSelector />
      <SubtitleSelector />
      <QualitySelector />
      <PlaybackTuningSelector />

      {/* MPV renders into its own native surface, which PiP cannot capture. */}
      {playbackEngine !== 'mpv' && (
        <button
          type="button"
          onClick={onTogglePiP}
          className={roundButton(size)}
          title={text.pictureInPicture}
          aria-label={text.pictureInPicture}
        >
          <PictureInPicture2 size={icon} strokeWidth={2.4} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        onClick={onToggleSidebar}
        className={
          size === 'l'
            ? `flex ${CONTROL_SIZE[size].height} shrink-0 items-center gap-2 rounded-full pl-4 pr-5 text-[15px] font-bold transition-colors ${
                isPlayerSidebarOpen ? filledClasses(tone) : 'bg-raised text-white hover:bg-surface-800'
              }`
            : roundButton(size, isPlayerSidebarOpen ? tone : undefined)
        }
        title={text.listTitle}
        aria-label={text.listLabel}
        aria-pressed={isPlayerSidebarOpen}
      >
        <List size={icon} strokeWidth={2.8} aria-hidden="true" />
        {size === 'l' && <span>{text.listLabel}</span>}
      </button>

      <button
        type="button"
        onClick={onToggleFullscreen}
        className={roundButton(size)}
        title={text.fullscreenTitle}
        aria-label={isFullscreen ? text.exitFullscreen : text.enterFullscreen}
      >
        {isFullscreen ? (
          <Minimize size={icon} strokeWidth={2.6} aria-hidden="true" />
        ) : (
          <Maximize size={icon} strokeWidth={2.6} aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
