import { useMemo } from 'react'
import { useStore } from '@/store'
import { overlaySubtitleBottom, overlaySubtitleShadow } from './subtitle-clearance'

interface PlayerSize {
  width: number
  height: number
}

interface SubtitleOverlayProps {
  playerSize: PlayerSize
  /** How far the shown controls reach above the player's bottom edge (CSS px); 0 while they are hidden. */
  dockClearance: number
}

export function SubtitleOverlay({ playerSize, dockClearance }: SubtitleOverlayProps) {
  const activeSubtitleCues = useStore((s) => s.activeSubtitleCues)
  const currentSubtitleTrack = useStore((s) => s.currentSubtitleTrack)
  const subtitleFontSizeSetting = useStore((s) => s.settings.subtitleFontSize)
  const subtitleColor = useStore((s) => s.settings.subtitleColor)
  const subtitleBackground = useStore((s) => s.settings.subtitleBackground)
  const subtitleFont = useStore((s) => s.settings.subtitleFont)
  const subtitleBold = useStore((s) => s.settings.subtitleBold)
  const subtitleOutline = useStore((s) => s.settings.subtitleOutline)
  const subtitlePosition = useStore((s) => s.settings.subtitlePosition)

  const subtitleScale = useMemo(() => {
    const scaleByHeight = playerSize.height / 720
    const scaleByWidth = playerSize.width / 1280
    const rawScale = Math.min(scaleByHeight, scaleByWidth)
    return Math.max(0.7, Math.min(1.8, Number.isFinite(rawScale) ? rawScale : 1))
  }, [playerSize.height, playerSize.width])

  const subtitleFontSize = Math.max(10, Math.round(subtitleFontSizeSetting * subtitleScale))
  const subtitleBottomOffset = overlaySubtitleBottom(playerSize.height, dockClearance, subtitlePosition)
  const subtitleHorizontalPadding = Math.max(12, Math.round(playerSize.width * 0.03))

  if (!currentSubtitleTrack) return null
  if (activeSubtitleCues.length === 0) return null

  return (
    <div
      className="absolute inset-x-0 flex flex-col items-center gap-1 pointer-events-none"
      style={{ bottom: `${subtitleBottomOffset}px`, paddingInline: `${subtitleHorizontalPadding}px` }}
    >
      {activeSubtitleCues.map((cue) => (
        <div
          key={`${cue.startTime}-${cue.endTime}`}
          className="rounded px-3 py-1 text-center leading-relaxed max-w-[80%]"
          style={{
            fontSize: `${subtitleFontSize}px`,
            color: cue.style?.color || subtitleColor,
            backgroundColor: subtitleBackground,
            ...(subtitleFont ? { fontFamily: `"${subtitleFont}", sans-serif` } : {}),
            fontWeight: subtitleBold || cue.style?.bold ? 'bold' : 'normal',
            fontStyle: cue.style?.italic ? 'italic' : 'normal',
            textShadow: overlaySubtitleShadow(subtitleOutline),
            whiteSpace: 'pre-line'
          }}
        >
          {cue.text}
        </div>
      ))}
    </div>
  )
}
