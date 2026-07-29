import { useEffect, useId, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useStore } from '@/store'
import { AUTO_VIDEO_QUALITY_ID } from '@/services/quality'

export function QualitySelector() {
  const { videoQualityOptions, currentVideoQuality, activeVideoQuality, setCurrentVideoQuality } = useStore()
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
      ? `Oto ${activeOption.shortLabel}`
      : selectedOption?.shortLabel || 'Kalite'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm hover:bg-white/10 transition-colors duration-normal"
        title="Goruntu kalitesi"
        aria-label="Görüntü kalitesi seç"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <SlidersHorizontal size={16} />
        <span className="max-w-[88px] truncate text-xs font-medium">{buttonLabel}</span>
      </button>
      {open && (
        <ul
          id={menuId}
          // Capped + scrollable: this opens upward and HLS ladders can carry
          // more renditions than fit above the control bar.
          className="absolute bottom-full right-0 mb-2 max-h-[calc(100vh-5rem)] w-56 list-none overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 py-1 shadow-lg"
          aria-label="Görüntü Kalitesi"
        >
          <li className="px-3 py-1.5 text-xs font-medium text-surface-500">Goruntu Kalitesi</li>
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
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-800 transition-colors duration-normal ${
                    isSelected ? 'text-accent' : 'text-surface-200'
                  }`}
                  aria-current={isSelected ? 'true' : undefined}
                >
                  <span className="truncate">{option.label}</span>
                  {isAutoActive && (
                    <span className="shrink-0 text-label text-surface-500">{activeOption.shortLabel}</span>
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
