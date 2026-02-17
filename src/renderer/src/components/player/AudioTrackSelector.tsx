import { useState, useRef, useEffect } from 'react'
import { Languages } from 'lucide-react'
import { useStore } from '@/store'

export function AudioTrackSelector() {
  const { audioTracks, currentAudioTrack, setCurrentAudioTrack } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (audioTracks.length <= 1) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg p-2 hover:bg-white/10 transition-colors"
        title="Ses Kanallari"
      >
        <Languages size={18} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-48 rounded-lg border border-surface-700 bg-surface-900 py-1 shadow-xl">
          <p className="px-3 py-1.5 text-xs font-medium text-surface-500 uppercase">Ses</p>
          {audioTracks.map((track, index) => (
            <button
              key={track.id}
              onClick={() => { setCurrentAudioTrack(track.id); setOpen(false) }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-800 transition-colors ${
                track.id === currentAudioTrack ? 'text-accent' : 'text-surface-200'
              }`}
            >
              {track.name || track.lang || `Ses ${index + 1}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
