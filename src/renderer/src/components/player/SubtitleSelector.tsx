import { useState, useRef, useEffect } from 'react'
import { Subtitles, Upload } from 'lucide-react'
import { useStore } from '@/store'
import { mpvAddSubtitleFile, pickAndReadFile } from '@/services/platform'
import { parseSubtitles } from '@/services/subtitle-parser'

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
  const {
    subtitleTracks, currentSubtitleTrack, playbackEngine, setCurrentSubtitleTrack,
    setSubtitleCues, setActiveSubtitleCues, settings, updateSettings
  } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const subtitleOpacity = parseSubtitleBackgroundOpacity(settings.subtitleBackground)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLoadExternal = async () => {
    const result = await pickAndReadFile([
      { name: 'Altyazi Dosyalari', extensions: ['srt', 'vtt', 'ass', 'ssa'] }
    ])
    if (!result) return

    if (playbackEngine === 'mpv') {
      const trackId = await mpvAddSubtitleFile(result.path)
      if (trackId !== null) {
        setSubtitleCues([])
        setActiveSubtitleCues([])
        setCurrentSubtitleTrack(`mpv-s:${trackId}`)
      }
      setOpen(false)
      return
    }

    const cues = parseSubtitles(result.content, result.path)
    setSubtitleCues(cues)
    setCurrentSubtitleTrack('external')
    setOpen(false)
  }

  const handleOff = () => {
    setCurrentSubtitleTrack(null)
    setActiveSubtitleCues([])
    setSubtitleCues([])
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`rounded-lg p-2 hover:bg-white/10 transition-colors ${currentSubtitleTrack ? 'text-accent' : ''}`}
        title="Altyazi"
      >
        <Subtitles size={18} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-64 rounded-lg border border-surface-700 bg-surface-900 py-1 shadow-xl">
          <p className="px-3 py-1.5 text-xs font-medium text-surface-500 uppercase">Altyazi</p>
          <button
            onClick={handleOff}
            className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-800 transition-colors ${
              !currentSubtitleTrack ? 'text-accent' : 'text-surface-200'
            }`}
          >
            Kapali
          </button>
          {subtitleTracks.map((track) => (
            <button
              key={track.id}
              onClick={() => { setCurrentSubtitleTrack(String(track.id)); setOpen(false) }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-800 transition-colors ${
                String(track.id) === currentSubtitleTrack ? 'text-accent' : 'text-surface-200'
              }`}
            >
              {track.name || track.lang || `Altyazi ${track.id}`}
            </button>
          ))}
          <div className="border-t border-surface-700 mt-1 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-surface-500">
              Altyazi Stili
            </p>
            <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
              <span>Yazi boyutu</span>
              <span>{settings.subtitleFontSize}px</span>
            </div>
            <input
              type="range"
              min={16}
              max={48}
              step={2}
              value={settings.subtitleFontSize}
              onChange={(e) =>
                updateSettings({ subtitleFontSize: Number.parseInt(e.target.value, 10) || 24 })
              }
              className="mt-1 w-full"
            />

            <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2">
              <div className="flex items-center justify-between text-xs text-surface-400">
                <span>Renk</span>
              </div>
              <input
                type="color"
                value={settings.subtitleColor}
                onChange={(e) => updateSettings({ subtitleColor: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-surface-600 bg-surface-800 p-0.5"
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
              <span>Arka plan</span>
              <span>{subtitleOpacity}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={subtitleOpacity}
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
                  fontSize: `${Math.max(12, settings.subtitleFontSize - 4)}px`,
                  color: settings.subtitleColor,
                  backgroundColor: settings.subtitleBackground
                }}
              >
                Altyazi onizleme
              </span>
            </div>
          </div>

          <div className="border-t border-surface-700 px-3 py-1">
            <button
              onClick={handleLoadExternal}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-surface-300 hover:bg-surface-800 transition-colors"
            >
              <Upload size={14} /> Disaridan dosya yukle
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
