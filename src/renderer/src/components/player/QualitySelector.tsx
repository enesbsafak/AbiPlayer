import { useEffect, useId, useRef, useState } from 'react'
import { MonitorPlay } from 'lucide-react'
import { useStore } from '@/store'
import { AUTO_VIDEO_QUALITY_ID } from '@/services/quality'
import { strings } from '@/strings'
import { DockPill } from './DockPill'
import { CONTROL_SIZE, MENU_HEADING, MENU_PANEL, menuRow, useDockLayout } from './player-ui'

const text = strings.player.quality

export function QualitySelector() {
  const videoQualityOptions = useStore((s) => s.videoQualityOptions)
  const currentVideoQuality = useStore((s) => s.currentVideoQuality)
  const activeVideoQuality = useStore((s) => s.activeVideoQuality)
  const setCurrentVideoQuality = useStore((s) => s.setCurrentVideoQuality)
  const { size, tone } = useDockLayout()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (videoQualityOptions.length === 0) return null

  const selectedOption = videoQualityOptions.find((option) => option.id === currentVideoQuality) || null
  const activeOption = videoQualityOptions.find((option) => option.id === activeVideoQuality) || null

  const buttonLabel =
    currentVideoQuality === AUTO_VIDEO_QUALITY_ID && activeOption
      ? text.auto(activeOption.shortLabel)
      : selectedOption?.shortLabel || text.fallback

  return (
    <div ref={ref} className="relative">
      <DockPill
        icon={<MonitorPlay size={CONTROL_SIZE[size].icon} strokeWidth={2.4} aria-hidden="true" />}
        label={text.fallback}
        value={buttonLabel}
        active={open}
        onClick={() => setOpen((value) => !value)}
        title={text.title}
        aria-label={text.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      />
      {open && (
        <ul
          id={menuId}
          // Capped + scrollable: this opens upward and HLS ladders can carry
          // more renditions than fit above the control bar.
          className={`${MENU_PANEL} w-64 list-none space-y-1`}
          aria-label={text.heading}
        >
          <li className={MENU_HEADING}>{text.heading}</li>
          {videoQualityOptions.map((option) => {
            const isSelected = option.id === currentVideoQuality
            const isAutoActive = option.id === AUTO_VIDEO_QUALITY_ID && !!activeOption
            return (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentVideoQuality(option.id)
                    setOpen(false)
                  }}
                  className={menuRow(isSelected, tone)}
                  aria-current={isSelected ? 'true' : undefined}
                >
                  <span className="truncate">{option.label}</span>
                  {isAutoActive && (
                    <span className={`shrink-0 text-[13px] font-medium ${isSelected ? 'text-ink' : 'text-surface-500'}`}>
                      {activeOption.shortLabel}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
