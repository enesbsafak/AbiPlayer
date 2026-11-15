import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Maximize2 } from 'lucide-react'
import { CloseIcon } from '@/components/ui/icons'
import { useStore } from '@/store'
import { isMpvHoldingPlayback, useMpvPlayer, type MpvPlayerOptions } from '@/hooks/useMpvPlayer'
import { useKeepDisplayAwake } from '@/hooks/useKeepDisplayAwake'
import { mpvSetVideoRect } from '@/services/platform'
import type { CornerRect } from '@/player/corner-rect'
import { strings } from '@/strings'
import { OVER_VIDEO } from './player-ui'

const text = strings.player.corner

// mpv keeps playing when this host goes away while its playback is still the
// current one: expanding hands it back to the player route. Closing, or
// starting another item, ends it here.
const CORNER_HOST: MpvPlayerOptions = {
  keepPlayingOnUnmount: () => {
    const playbackId = useStore.getState().currentPlayback?.playbackId ?? null
    return playbackId !== null && isMpvHoldingPlayback(playbackId)
  }
}

/**
 * Experimental (plan F2-15, setting "köşede oynatmaya devam et"): after the
 * player route is left, mpv keeps playing inside `rect`. The page is opaque
 * everywhere else (AppShell clips it) and transparent here, so the mpv surface
 * behind it shows through; mpv's own margins confine the picture to the same
 * rectangle.
 */
export default function CornerPlayer({ rect }: { rect: CornerRect }) {
  const navigate = useNavigate()
  const currentChannel = useStore((s) => s.currentChannel)
  const playerError = useStore((s) => s.playerError)
  const stopPlayback = useStore((s) => s.stopPlayback)
  const clearPlayerReturnTarget = useStore((s) => s.clearPlayerReturnTarget)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)

  useMpvPlayer(true, CORNER_HOST)
  useKeepDisplayAwake()

  const { left, top, width, height } = rect
  useEffect(() => {
    void mpvSetVideoRect({ left, top, width, height }).catch(() => undefined)
  }, [left, top, width, height])

  // Whatever comes next (the full player, or nothing) gets the whole window.
  useEffect(() => () => void mpvSetVideoRect(null).catch(() => undefined), [])

  if (!currentChannel) return null

  return (
    <section
      aria-label={text.label}
      data-corner-player
      // Square corners and an edge in the raised colour: mpv draws the picture
      // as a plain rectangle under this box, so a rounded box would leave its
      // corners showing outside the edge.
      className="no-drag fixed z-overlay overflow-hidden ring-2 ring-raised"
      style={{ left, top, width, height }}
    >
      {/* Flat chips over the picture, no shade: a name and two round buttons. */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
        <p className={`min-w-0 truncate rounded-full px-3 py-1.5 text-[13px] font-bold text-white ${OVER_VIDEO}`}>
          {currentChannel.name}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setMiniPlayer(false)
              void navigate('/player')
            }}
            aria-label={text.expand}
            title={text.expandTitle}
            className={`flex size-9 items-center justify-center rounded-full text-white transition-colors hover:bg-raised ${OVER_VIDEO}`}
          >
            <Maximize2 size={16} strokeWidth={2.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMiniPlayer(false)
              stopPlayback()
              clearPlayerReturnTarget()
            }}
            aria-label={text.stop}
            title={text.stopTitle}
            className={`flex size-9 items-center justify-center rounded-full text-white transition-colors hover:bg-raised ${OVER_VIDEO}`}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>
      {playerError && (
        <p className={`absolute inset-x-2 bottom-2 rounded-[14px] px-3 py-2 text-[13px] font-medium text-white ${OVER_VIDEO}`}>
          {playerError}
        </p>
      )}
    </section>
  )
}
