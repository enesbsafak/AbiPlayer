import { useState, useRef, useEffect } from 'react'
import { Captions, Upload } from 'lucide-react'
import { useStore } from '@/store'
import { useExternalSubtitleLoader } from '@/hooks/useExternalSubtitleLoader'
import { strings } from '@/strings'
import { MAX_SUBTITLE_POSITION } from '../../../../shared/subtitle-style'
import { DockPill } from './DockPill'
import { PlayerRange } from './PlayerRange'
import { CONTROL_SIZE, MENU_HEADING, menuRow, useDockLayout } from './player-ui'

const text = strings.player.subtitles

function parseSubtitleBackgroundOpacity(background: string): number {
  const match = background.match(
    /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([0-9]*\.?[0-9]+)\s*)?\)/i
  )
  if (!match) return 75
  const alpha = match[1] ? Number.parseFloat(match[1]) : 1
  if (!Number.isFinite(alpha)) return 75
  return Math.round(Math.max(0, Math.min(1, alpha)) * 100)
}

export function SubtitleSelector() {
  const subtitleTracks = useStore((s) => s.subtitleTracks)
  const currentSubtitleTrack = useStore((s) => s.currentSubtitleTrack)
  const selectSubtitleTrack = useStore((s) => s.selectSubtitleTrack)
  const applyPlayerPatch = useStore((s) => s.applyPlayerPatch)
  const subtitleFontSize = useStore((s) => s.settings.subtitleFontSize)
  const subtitleColor = useStore((s) => s.settings.subtitleColor)
  const subtitleBackground = useStore((s) => s.settings.subtitleBackground)
  const subtitlePosition = useStore((s) => s.settings.subtitlePosition)
  const updateSettings = useStore((s) => s.updateSettings)
  const { size, tone } = useDockLayout()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const subtitleOpacity = parseSubtitleBackgroundOpacity(subtitleBackground)
  const externalLoader = useExternalSubtitleLoader()
  const { clearError: clearLoadError } = externalLoader

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!open) clearLoadError()
  }, [open, clearLoadError])

  const handleLoadExternal = async () => {
    const result = await externalLoader.load()
    // A failure keeps the menu open so its message stays readable.
    if (result === 'loaded') setOpen(false)
  }

  const handleOff = () => {
    selectSubtitleTrack(null)
    applyPlayerPatch({ subtitleCues: [], activeSubtitleCues: [] })
    setOpen(false)
  }

  const currentTrack = currentSubtitleTrack
    ? subtitleTracks.find((track) => String(track.id) === currentSubtitleTrack)
    : undefined
  const value = !currentSubtitleTrack
    ? text.off
    : currentTrack?.name || currentTrack?.lang || text.fallback(currentSubtitleTrack)

  return (
    <div ref={ref} className="relative">
      <DockPill
        icon={<Captions size={CONTROL_SIZE[size].icon} strokeWidth={2.4} aria-hidden="true" />}
        label={text.title}
        value={value}
        active={open}
        onClick={() => setOpen(!open)}
        title={text.title}
        aria-label={text.label}
        aria-haspopup="true"
        aria-expanded={open}
      />
      {/*
        The panel opens upward from the control bar, so it must be capped to the
        space above it. Streams routinely carry 15+ subtitle tracks and the
        unbounded list grew straight past the top of the window, leaving the
        first entries clipped and unreachable. Only the track list scrolls — the
        style controls stay pinned so they are always in reach.
      */}
      {open && (
        <div className="absolute bottom-full right-0 z-dropdown mb-3 flex max-h-[calc(100vh-12rem)] w-80 flex-col gap-2 rounded-tile bg-raised p-2 text-white">
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            <p className={MENU_HEADING}>{text.heading}</p>
            <button type="button" onClick={handleOff} className={menuRow(!currentSubtitleTrack, tone)}>
              <span className="truncate">{text.off}</span>
            </button>
            {subtitleTracks.map((track) => (
              <button
                key={track.id}
                type="button"
                onClick={() => { selectSubtitleTrack(String(track.id)); setOpen(false) }}
                className={menuRow(String(track.id) === currentSubtitleTrack, tone)}
              >
                <span className="truncate">{track.name || track.lang || text.fallback(track.id)}</span>
              </button>
            ))}
          </div>

          <div className="shrink-0 space-y-2.5 rounded-card bg-ground px-4 py-3">
            <p className="text-[15px] font-bold">{text.style}</p>
            <div>
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-surface-500">{text.fontSize}</span>
                <span className="font-bold tabular-nums">{subtitleFontSize}px</span>
              </div>
              <PlayerRange
                min={16}
                max={48}
                step={2}
                value={subtitleFontSize}
                aria-label={text.fontSizeLabel}
                onChange={(e) =>
                  updateSettings({ subtitleFontSize: Number.parseInt(e.target.value, 10) || 24 })
                }
                className="w-full"
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-[14px]">
              <span className="text-surface-500">{text.color}</span>
              <input
                type="color"
                value={subtitleColor}
                aria-label={text.colorLabel}
                onChange={(e) => updateSettings({ subtitleColor: e.target.value })}
                className="h-9 w-14 cursor-pointer rounded-full border-0 bg-raised p-1 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-surface-500">{text.background}</span>
                <span className="font-bold tabular-nums">{subtitleOpacity}%</span>
              </div>
              <PlayerRange
                min={0}
                max={100}
                step={5}
                value={subtitleOpacity}
                aria-label={text.backgroundLabel}
                onChange={(e) => {
                  const opacity = Number.parseInt(e.target.value, 10)
                  const alpha = Math.max(0, Math.min(100, opacity)) / 100
                  updateSettings({ subtitleBackground: `rgba(0,0,0,${alpha.toFixed(2)})` })
                }}
                className="w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-surface-500">{text.position}</span>
                <span className="font-bold tabular-nums">{strings.settings.subtitles.positionValue(subtitlePosition)}</span>
              </div>
              <PlayerRange
                min={0}
                max={MAX_SUBTITLE_POSITION}
                step={2}
                value={subtitlePosition}
                aria-label={text.positionLabel}
                onChange={(e) => updateSettings({ subtitlePosition: Number.parseInt(e.target.value, 10) || 0 })}
                className="w-full"
              />
            </div>

            <div className="rounded-[14px] bg-deep px-2 py-2 text-center">
              <span
                className="rounded px-2 py-0.5"
                style={{
                  fontSize: `${Math.max(12, subtitleFontSize - 4)}px`,
                  color: subtitleColor,
                  backgroundColor: subtitleBackground
                }}
              >
                {text.preview}
              </span>
            </div>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => void handleLoadExternal()}
              className="flex min-h-12 w-full items-center gap-2.5 rounded-full px-4 text-[15px] font-bold text-white transition-colors hover:bg-surface-800"
            >
              <Upload size={18} strokeWidth={2.4} aria-hidden="true" /> {text.loadExternal}
            </button>
            {externalLoader.error && (
              <p role="alert" className="px-4 pb-2 text-[14px] text-coral">
                {externalLoader.error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
