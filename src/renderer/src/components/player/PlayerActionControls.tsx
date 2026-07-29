import { List, Maximize, Minimize, PictureInPicture2, X } from 'lucide-react'
import { useStore } from '@/store'
import { AudioTrackSelector } from './AudioTrackSelector'
import { QualitySelector } from './QualitySelector'
import { SubtitleSelector } from './SubtitleSelector'

const ICON_BUTTON = 'rounded-lg p-2 transition-colors duration-normal hover:bg-white/10'

interface PlayerActionControlsProps {
  /** Both need the video element / fullscreen coordination the parent owns. */
  onExit: () => void
  onTogglePiP: () => void
  onToggleFullscreen: () => void
}

/**
 * Right-hand cluster: track/quality pickers and window-level toggles. Reads its
 * own state from the store, like the selectors it renders.
 */
export function PlayerActionControls({
  onExit,
  onTogglePiP,
  onToggleFullscreen
}: PlayerActionControlsProps) {
  const playbackEngine = useStore((s) => s.playbackEngine)
  const isFullscreen = useStore((s) => s.isFullscreen)
  const isPlayerSidebarOpen = useStore((s) => s.isPlayerSidebarOpen)
  const onToggleSidebar = useStore((s) => s.togglePlayerSidebar)

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onExit} className={ICON_BUTTON} title="Durdur ve çık" aria-label="Durdur ve çık">
        <X size={18} />
      </button>

      <QualitySelector />
      <AudioTrackSelector />
      <SubtitleSelector />

      {/* MPV renders into its own native surface, which PiP cannot capture. */}
      {playbackEngine !== 'mpv' && (
        <button
          type="button"
          onClick={onTogglePiP}
          className={ICON_BUTTON}
          title="Resim İçinde Resim"
          aria-label="Resim İçinde Resim"
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
        title="Kanal Listesi (L)"
        aria-label="Kanal Listesi"
        aria-pressed={isPlayerSidebarOpen}
      >
        <List size={18} />
      </button>

      <button
        type="button"
        onClick={onToggleFullscreen}
        className={ICON_BUTTON}
        title="Tam Ekran (F)"
        aria-label={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
      >
        {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
      </button>
    </div>
  )
}
