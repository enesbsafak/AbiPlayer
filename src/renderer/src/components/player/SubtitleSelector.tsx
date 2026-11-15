import { useState, useRef, useEffect } from 'react'
import { Subtitles, Upload } from 'lucide-react'
import { useStore } from '@/store'
import { useExternalSubtitleLoader } from '@/hooks/useExternalSubtitleLoader'
import { strings } from '@/strings'

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
  const updateSettings = useStore((s) => s.updateSettings)
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`rounded-lg p-2 hover:bg-white/10 transition-colors duration-normal ${currentSubtitleTrack ? 'text-accent' : ''}`}
        title={text.title}
        aria-label={text.label}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Subtitles size={18} />
      </button>
      {/*
        The panel opens upward from the control bar, so it must be capped to the
        space above it. Streams routinely carry 15+ subtitle tracks and the
        unbounded list grew straight past the top of the window, leaving the
        first entries clipped and unreachable. Only the track list scrolls — the
        style controls stay pinned so they are always in reach.
      */}
      {open && (
        <div className="absolute bottom-full right-0 mb-2 flex max-h-[calc(100vh-5rem)] w-64 flex-col rounded-lg border border-surface-700 bg-surface-900 shadow-lg">
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            <p className="px-3 py-1.5 text-xs font-medium text-surface-500">{text.heading}</p>
            <button
              type="button"
              onClick={handleOff}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-800 transition-colors ${
                !currentSubtitleTrack ? 'text-accent' : 'text-surface-200'
              }`}
            >
              {text.off}
            </button>
            {subtitleTracks.map((track) => (
              <button
                key={track.id}
                type="button"
                onClick={() => { selectSubtitleTrack(String(track.id)); setOpen(false) }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-800 transition-colors ${
                  String(track.id) === currentSubtitleTrack ? 'text-accent' : 'text-surface-200'
                }`}
              >
                {track.name || track.lang || text.fallback(track.id)}
              </button>
            ))}
          </div>
          <div className="shrink-0 border-t border-surface-700 px-3 py-2">
            <p className="text-label font-medium text-surface-500">
              {text.style}
            </p>
            <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
              <span>{text.fontSize}</span>
              <span>{subtitleFontSize}px</span>
            </div>
            <input
              type="range"
              min={16}
              max={48}
              step={2}
              value={subtitleFontSize}
              aria-label={text.fontSizeLabel}
              onChange={(e) =>
                updateSettings({ subtitleFontSize: Number.parseInt(e.target.value, 10) || 24 })
              }
              className="mt-1 w-full"
            />

            <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2">
              <div className="flex items-center justify-between text-xs text-surface-400">
                <span>{text.color}</span>
              </div>
              <input
                type="color"
                value={subtitleColor}
                aria-label={text.colorLabel}
                onChange={(e) => updateSettings({ subtitleColor: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-surface-600 bg-surface-800 p-0.5"
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
              <span>{text.background}</span>
              <span>{subtitleOpacity}%</span>
            </div>
            <input
              type="range"
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
              className="mt-1 w-full"
            />

            <div className="mt-2 rounded border border-surface-700 bg-black/70 px-2 py-1 text-center">
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

          <div className="shrink-0 border-t border-surface-700 px-3 py-1">
            <button
              type="button"
              onClick={() => void handleLoadExternal()}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-surface-300 hover:bg-surface-800 transition-colors"
            >
              <Upload size={14} /> {text.loadExternal}
            </button>
            {externalLoader.error && (
              <p role="alert" className="px-3 pb-2 text-xs text-red-400">
                {externalLoader.error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
