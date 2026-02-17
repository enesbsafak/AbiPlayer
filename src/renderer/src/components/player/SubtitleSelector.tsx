import { useState, useRef, useEffect } from 'react'
import { Subtitles, Upload } from 'lucide-react'
import { useStore } from '@/store'
import { pickAndReadFile } from '@/services/platform'
import { parseSubtitles } from '@/services/subtitle-parser'

export function SubtitleSelector() {
  const {
    subtitleTracks, currentSubtitleTrack, setCurrentSubtitleTrack,
    setSubtitleCues, setActiveSubtitleCues
  } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLoadExternal = async () => {
    const result = await pickAndReadFile([
      { name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass', 'ssa'] }
    ])
    if (!result) return

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
        title="Subtitles"
      >
        <Subtitles size={18} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-52 rounded-lg border border-surface-700 bg-surface-900 py-1 shadow-xl">
          <p className="px-3 py-1.5 text-xs font-medium text-surface-500 uppercase">Subtitles</p>
          <button
            onClick={handleOff}
            className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-800 transition-colors ${
              !currentSubtitleTrack ? 'text-accent' : 'text-surface-200'
            }`}
          >
            Off
          </button>
          {subtitleTracks.map((track) => (
            <button
              key={track.id}
              onClick={() => { setCurrentSubtitleTrack(String(track.id)); setOpen(false) }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-800 transition-colors ${
                String(track.id) === currentSubtitleTrack ? 'text-accent' : 'text-surface-200'
              }`}
            >
              {track.name || track.lang || `Subtitle ${track.id}`}
            </button>
          ))}
          <div className="border-t border-surface-700 mt-1 pt-1">
            <button
              onClick={handleLoadExternal}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-surface-300 hover:bg-surface-800 transition-colors"
            >
              <Upload size={14} /> Load external file
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
