import { useState, useRef, useEffect, useId } from 'react'
import { Languages } from 'lucide-react'
import { useStore } from '@/store'
import { strings } from '@/strings'
import { DockPill } from './DockPill'
import { CONTROL_SIZE, MENU_HEADING, MENU_PANEL, menuRow, useDockLayout } from './player-ui'

const text = strings.player.audio

export function AudioTrackSelector() {
  const audioTracks = useStore((s) => s.audioTracks)
  const currentAudioTrack = useStore((s) => s.currentAudioTrack)
  const setCurrentAudioTrack = useStore((s) => s.setCurrentAudioTrack)
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

  if (audioTracks.length <= 1) return null

  const trackName = (index: number) => {
    const track = audioTracks[index]
    return track?.name || track?.lang || text.fallback(index + 1)
  }
  const currentIndex = audioTracks.findIndex((track) => track.id === currentAudioTrack)

  return (
    <div ref={ref} className="relative">
      <DockPill
        icon={<Languages size={CONTROL_SIZE[size].icon} strokeWidth={2.4} aria-hidden="true" />}
        label={text.title}
        value={currentIndex >= 0 ? trackName(currentIndex) : text.unknown}
        active={open}
        onClick={() => setOpen(!open)}
        title={text.title}
        aria-label={text.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      />
      {open && (
        <ul
          id={menuId}
          // Capped + scrollable: this opens upward and multi-audio IPTV streams
          // can list more tracks than fit above the control bar.
          className={`${MENU_PANEL} w-64 list-none space-y-1`}
          aria-label={text.heading}
        >
          <li className={MENU_HEADING}>{text.heading}</li>
          {audioTracks.map((track, index) => (
            <li key={track.id}>
              <button
                type="button"
                onClick={() => { setCurrentAudioTrack(track.id); setOpen(false) }}
                className={menuRow(track.id === currentAudioTrack, tone)}
                aria-current={track.id === currentAudioTrack ? 'true' : undefined}
              >
                <span className="truncate">{trackName(index)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
