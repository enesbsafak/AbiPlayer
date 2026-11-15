import { useNavigate } from 'react-router-dom'
import { TONE } from '@/components/layout/sections'
import { CloseIcon, PlayIcon } from '@/components/ui/icons'
import { useStore } from '@/store'
import { strings } from '@/strings'
import { filledClasses, playerTone } from './player-ui'

const text = strings.player.mini

/**
 * Leaving /player suspends playback (mpv is stopped, the <video> unmounted), so
 * this card must not look like something is playing. "Devam et" goes back to
 * the player: a film or episode resumes from its saved position, live restarts.
 */
export function MiniPlayer() {
  const navigate = useNavigate()
  const currentChannel = useStore((s) => s.currentChannel)
  const currentPlayback = useStore((s) => s.currentPlayback)
  const clearPlayerReturnTarget = useStore((s) => s.clearPlayerReturnTarget)
  const stopPlayback = useStore((s) => s.stopPlayback)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)

  if (!currentChannel) return null

  const isLive = currentChannel.type === 'live'
  const tone = playerTone(currentPlayback, currentChannel)

  const handleResume = () => {
    setMiniPlayer(false)
    void navigate('/player')
  }

  return (
    <section
      className="fixed bottom-4 right-4 z-overlay flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-card bg-raised p-2.5"
      aria-label={text.label}
    >
      {/* A paused mark in the item's section colour: nothing is playing here. */}
      <span aria-hidden="true" className={`flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-ground ${TONE[tone].text}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" focusable="false">
          <rect x="6" y="5" width="4.5" height="14" rx="1.5" />
          <rect x="13.5" y="5" width="4.5" height="14" rx="1.5" />
        </svg>
      </span>
      <div className="min-w-0 pr-1">
        <p className="max-w-[220px] truncate text-[15px] font-bold text-white" title={currentChannel.name}>
          {currentChannel.name}
        </p>
        <p className="text-[13px] text-surface-500">{text.paused}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={handleResume}
          className={`flex h-11 items-center gap-2 rounded-full pl-3.5 pr-[18px] text-[15px] font-bold transition-opacity hover:opacity-90 ${filledClasses(tone)}`}
          aria-label={isLive ? text.backToLive : text.resume}
        >
          <PlayIcon size={16} />
          {text.continue}
        </button>
        <button
          type="button"
          onClick={() => {
            setMiniPlayer(false)
            stopPlayback()
            clearPlayerReturnTarget()
          }}
          className="flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-surface-800"
          aria-label={text.stop}
          title={text.stop}
        >
          <CloseIcon size={18} />
        </button>
      </div>
    </section>
  )
}
