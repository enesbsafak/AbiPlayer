import { useState, useRef, useEffect, useId } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useStore } from '@/store'
import { DEFAULT_PLAYBACK_TUNING } from '@/store/player-slice'

const ASPECT_OPTIONS = [
  { id: 'auto', label: 'Otomatik' },
  { id: '16:9', label: '16:9' },
  { id: '4:3', label: '4:3' }
] as const

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const

function formatDelay(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  if (ms === 0) return '0 ms'
  return `${ms > 0 ? '+' : ''}${ms} ms`
}

export function PlaybackTuningSelector() {
  const playbackEngine = useStore((s) => s.playbackEngine)
  const playbackTuning = useStore((s) => s.playbackTuning)
  const setPlaybackTuning = useStore((s) => s.setPlaybackTuning)
  const resetPlaybackTuning = useStore((s) => s.resetPlaybackTuning)
  const currentChannel = useStore((s) => s.currentChannel)
  const subtitleTracks = useStore((s) => s.subtitleTracks)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // These are mpv properties; the HTML5 fallback has no equivalent for audio
  // delay, so the whole panel would be misleading there.
  if (playbackEngine !== 'mpv') return null

  const isLive = currentChannel?.type === 'live'
  const isDefault =
    playbackTuning.audioDelay === DEFAULT_PLAYBACK_TUNING.audioDelay &&
    playbackTuning.subDelay === DEFAULT_PLAYBACK_TUNING.subDelay &&
    playbackTuning.speed === DEFAULT_PLAYBACK_TUNING.speed &&
    playbackTuning.aspectRatio === DEFAULT_PLAYBACK_TUNING.aspectRatio

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`rounded-lg p-2 transition-colors duration-normal ${
          isDefault ? 'hover:bg-white/10' : 'bg-white/20'
        }`}
        title="Senkron ve Görüntü"
        aria-label="Senkron ve görüntü ayarları"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <SlidersHorizontal size={18} />
      </button>

      {open && (
        <div
          id={menuId}
          className="absolute bottom-full right-0 mb-2 max-h-[calc(100vh-5rem)] w-72 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-3 shadow-lg"
          role="menu"
          aria-label="Senkron ve Görüntü"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-surface-500">Senkron ve Görüntü</p>
            <button
              type="button"
              onClick={resetPlaybackTuning}
              disabled={isDefault}
              className="rounded px-2 py-0.5 text-xs text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Sıfırla
            </button>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between">
              <label htmlFor={`${menuId}-audio-delay`} className="text-sm text-surface-300">
                Ses gecikmesi
              </label>
              <span className="text-xs tabular-nums text-surface-400">
                {formatDelay(playbackTuning.audioDelay)}
              </span>
            </div>
            <input
              id={`${menuId}-audio-delay`}
              type="range"
              min={-2}
              max={2}
              step={0.05}
              value={playbackTuning.audioDelay}
              onChange={(e) => setPlaybackTuning({ audioDelay: parseFloat(e.target.value) })}
              className="mt-1 w-full cursor-pointer"
            />
            <p className="text-xs leading-4 text-surface-500">
              Ses görüntüden önce geliyorsa sağa kaydırın.
            </p>
          </div>

          {subtitleTracks.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <label htmlFor={`${menuId}-sub-delay`} className="text-sm text-surface-300">
                  Altyazı gecikmesi
                </label>
                <span className="text-xs tabular-nums text-surface-400">
                  {formatDelay(playbackTuning.subDelay)}
                </span>
              </div>
              <input
                id={`${menuId}-sub-delay`}
                type="range"
                min={-5}
                max={5}
                step={0.1}
                value={playbackTuning.subDelay}
                onChange={(e) => setPlaybackTuning({ subDelay: parseFloat(e.target.value) })}
                className="mt-1 w-full cursor-pointer"
              />
            </div>
          )}

          {!isLive && (
            <div className="mt-3">
              <p className="text-sm text-surface-300">Oynatma hızı</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {SPEED_OPTIONS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => setPlaybackTuning({ speed })}
                    className={`rounded-md px-2 py-1 text-xs transition-colors ${
                      playbackTuning.speed === speed
                        ? 'border border-accent/45 bg-accent/15 text-accent'
                        : 'border border-surface-700 text-surface-300 hover:bg-surface-800'
                    }`}
                    aria-pressed={playbackTuning.speed === speed}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3">
            <p className="text-sm text-surface-300">En-boy oranı</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ASPECT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPlaybackTuning({ aspectRatio: option.id })}
                  className={`rounded-md px-2 py-1 text-xs transition-colors ${
                    playbackTuning.aspectRatio === option.id
                      ? 'border border-accent/45 bg-accent/15 text-accent'
                      : 'border border-surface-700 text-surface-300 hover:bg-surface-800'
                  }`}
                  aria-pressed={playbackTuning.aspectRatio === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-3 border-t border-surface-800 pt-2 text-xs leading-4 text-surface-500">
            Bu ayarlar yalnızca açık olan yayın için geçerlidir, kanal değişince sıfırlanır.
          </p>
        </div>
      )}
    </div>
  )
}
