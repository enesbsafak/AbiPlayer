import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Maximize2, X } from 'lucide-react'
import { useStore } from '@/store'
import { isMpvHoldingPlayback, useMpvPlayer, type MpvPlayerOptions } from '@/hooks/useMpvPlayer'
import { useKeepDisplayAwake } from '@/hooks/useKeepDisplayAwake'
import { mpvSetVideoRect } from '@/services/platform'
import type { CornerRect } from '@/player/corner-rect'

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
      aria-label="Köşe oynatıcı"
      data-corner-player
      className="no-drag fixed z-overlay overflow-hidden rounded-md ring-1 ring-surface-700"
      style={{ left, top, width, height }}
    >
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-2 pb-4 pt-1.5">
        <p className="min-w-0 truncate text-xs font-medium text-white">{currentChannel.name}</p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setMiniPlayer(false)
              void navigate('/player')
            }}
            aria-label="Oynatıcıyı büyüt"
            title="Büyüt"
            className="rounded p-1 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              setMiniPlayer(false)
              stopPlayback()
              clearPlayerReturnTarget()
            }}
            aria-label="Oynatmayı kapat"
            title="Kapat"
            className="rounded p-1 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {playerError && (
        <p className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-xs text-red-300">{playerError}</p>
      )}
    </section>
  )
}
