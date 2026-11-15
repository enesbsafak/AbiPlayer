import { useState, useRef, useEffect, useId } from 'react'
import { SlidersIcon } from '@/components/ui/icons'
import { useStore } from '@/store'
import { DEFAULT_PLAYBACK_TUNING } from '@/store/player-slice'
import { strings } from '@/strings'
import { DockPill } from './DockPill'
import { PlayerRange } from './PlayerRange'
import { CONTROL_SIZE, MENU_HEADING, choicePill, useDockLayout } from './player-ui'

const text = strings.player.tuning

const ASPECT_OPTIONS = [
  { id: 'auto', label: text.aspectAuto },
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
  const { size, tone } = useDockLayout()
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

  // What the pill says it is set to: each correction away from its default.
  const changes: string[] = []
  if (playbackTuning.speed !== DEFAULT_PLAYBACK_TUNING.speed) changes.push(text.speedValue(playbackTuning.speed))
  if (playbackTuning.aspectRatio !== DEFAULT_PLAYBACK_TUNING.aspectRatio) changes.push(playbackTuning.aspectRatio)
  if (playbackTuning.audioDelay !== DEFAULT_PLAYBACK_TUNING.audioDelay) changes.push(text.audioDelayValue(formatDelay(playbackTuning.audioDelay)))
  if (playbackTuning.subDelay !== DEFAULT_PLAYBACK_TUNING.subDelay) changes.push(text.subtitleDelayValue(formatDelay(playbackTuning.subDelay)))

  return (
    <div ref={ref} className="relative">
      <DockPill
        icon={<SlidersIcon size={CONTROL_SIZE[size].icon} />}
        label={text.pillLabel}
        value={isDefault ? text.unchanged : changes.join(' · ')}
        active={open || !isDefault}
        onClick={() => setOpen(!open)}
        title={text.title}
        aria-label={text.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      />

      {open && (
        <div
          id={menuId}
          className="absolute bottom-full right-0 z-dropdown mb-3 max-h-[calc(100vh-12rem)] w-80 overflow-y-auto rounded-tile bg-raised p-2 text-white"
          role="menu"
          aria-label={text.title}
        >
          <div className="flex items-center justify-between gap-2 pr-1">
            <p className={MENU_HEADING}>{text.title}</p>
            <button
              type="button"
              onClick={resetPlaybackTuning}
              disabled={isDefault}
              className="h-10 shrink-0 rounded-full border-2 border-white/50 px-4 text-[14px] font-bold text-white transition-colors hover:border-white disabled:cursor-default disabled:opacity-40 disabled:hover:border-white/50"
            >
              {strings.common.reset}
            </button>
          </div>

          <div className="mt-1 space-y-2">
            <div className="rounded-card bg-ground px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`${menuId}-audio-delay`} className="text-[15px] font-bold">
                  {text.audioDelay}
                </label>
                <span className="text-[14px] font-bold tabular-nums text-sun">
                  {formatDelay(playbackTuning.audioDelay)}
                </span>
              </div>
              <PlayerRange
                id={`${menuId}-audio-delay`}
                min={-2}
                max={2}
                step={0.05}
                value={playbackTuning.audioDelay}
                onChange={(e) => setPlaybackTuning({ audioDelay: parseFloat(e.target.value) })}
                className="mt-1 w-full"
              />
              <p className="text-[14px] leading-5 text-surface-500">{text.audioDelayHint}</p>
            </div>

            {subtitleTracks.length > 0 && (
              <div className="rounded-card bg-ground px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`${menuId}-sub-delay`} className="text-[15px] font-bold">
                    {text.subtitleDelay}
                  </label>
                  <span className="text-[14px] font-bold tabular-nums text-sun">
                    {formatDelay(playbackTuning.subDelay)}
                  </span>
                </div>
                <PlayerRange
                  id={`${menuId}-sub-delay`}
                  min={-5}
                  max={5}
                  step={0.1}
                  value={playbackTuning.subDelay}
                  onChange={(e) => setPlaybackTuning({ subDelay: parseFloat(e.target.value) })}
                  className="mt-1 w-full"
                />
              </div>
            )}

            {!isLive && (
              <div className="rounded-card bg-ground px-4 py-3">
                <p className="text-[15px] font-bold">{text.speed}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SPEED_OPTIONS.map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      onClick={() => setPlaybackTuning({ speed })}
                      className={choicePill(playbackTuning.speed === speed, tone)}
                      aria-pressed={playbackTuning.speed === speed}
                    >
                      {text.speedValue(speed)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-card bg-ground px-4 py-3">
              <p className="text-[15px] font-bold">{text.aspect}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ASPECT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPlaybackTuning({ aspectRatio: option.id })}
                    className={choicePill(playbackTuning.aspectRatio === option.id, tone)}
                    aria-pressed={playbackTuning.aspectRatio === option.id}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="px-3 pb-2 pt-3 text-[14px] leading-5 text-surface-500">{text.scopeHint}</p>
        </div>
      )}
    </div>
  )
}
