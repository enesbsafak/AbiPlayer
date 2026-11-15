import { ArrowLeft, List, Maximize, Minimize, PictureInPicture2 } from 'lucide-react'
import { useStore } from '@/store'
import { AudioTrackSelector } from './AudioTrackSelector'
import { PlaybackTuningSelector } from './PlaybackTuningSelector'
import { QualitySelector } from './QualitySelector'
import { SubtitleSelector } from './SubtitleSelector'
import { strings } from '@/strings'

const text = strings.player.actions

const ICON_BUTTON = 'rounded-lg p-2 transition-colors duration-normal hover:bg-white/10'

interface PlayerActionControlsProps {
  /** All three need the video element / fullscreen coordination the parent owns. */
  onLeave: () => void
  onTogglePiP: () => void
  onToggleFullscreen: () => void
}

/**
 * Right-hand cluster: track/quality pickers and window-level actions — leaving
 * the player, the channel list and fullscreen. Reads its own state from the
 * store, like the selectors it renders.
 *
 * There is deliberately no "stop and exit" button. It used to sit next to the
 * back arrow looking like a second way out, while actually doing something
 * else (ending playback instead of minimising it) — a distinction the two icons
 * could not convey. Stopping now lives on the mini player, where it reads as
 * "close this".
 */
export function PlayerActionControls({
  onLeave,
  onTogglePiP,
  onToggleFullscreen
}: PlayerActionControlsProps) {
  const playbackEngine = useStore((s) => s.playbackEngine)
  const isFullscreen = useStore((s) => s.isFullscreen)
  const isPlayerSidebarOpen = useStore((s) => s.isPlayerSidebarOpen)
  const onToggleSidebar = useStore((s) => s.togglePlayerSidebar)

  return (
    <div className="flex items-center gap-1">
      <QualitySelector />
      <AudioTrackSelector />
      <SubtitleSelector />
      <PlaybackTuningSelector />

      {/* MPV renders into its own native surface, which PiP cannot capture. */}
      {playbackEngine !== 'mpv' && (
        <button
          type="button"
          onClick={onTogglePiP}
          className={ICON_BUTTON}
          title={text.pictureInPicture}
          aria-label={text.pictureInPicture}
        >
          <PictureInPicture2 size={18} />
        </button>
      )}

      <button
        type="button"
        onClick={onToggleSidebar}
        className={`rounded-lg p-2 transition-colors duration-normal ${
          isPlayerSidebarOpen ? 'bg-white/20' : 'hover:bg-white/10'
        }`}
        title={text.listTitle}
        aria-label={text.listLabel}
        aria-pressed={isPlayerSidebarOpen}
      >
        <List size={18} />
      </button>

      <button
        type="button"
        onClick={onToggleFullscreen}
        className={ICON_BUTTON}
        title={text.fullscreenTitle}
        aria-label={isFullscreen ? text.exitFullscreen : text.enterFullscreen}
      >
        {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
      </button>

      <button
        type="button"
        onClick={onLeave}
        className={ICON_BUTTON}
        title={text.leaveTitle}
        aria-label={text.leaveLabel}
      >
        <ArrowLeft size={18} />
      </button>
    </div>
  )
}
