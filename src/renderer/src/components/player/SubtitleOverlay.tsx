import { useMemo } from 'react'
import { useStore } from '@/store'

interface PlayerSize {
  width: number
  height: number
}

interface SubtitleOverlayProps {
  playerSize: PlayerSize
}

export function SubtitleOverlay({ playerSize }: SubtitleOverlayProps) {
  const { activeSubtitleCues, currentSubtitleTrack, settings } = useStore()

  const subtitleScale = useMemo(() => {
    const scaleByHeight = playerSize.height / 720
    const scaleByWidth = playerSize.width / 1280
    const rawScale = Math.min(scaleByHeight, scaleByWidth)
    return Math.max(0.7, Math.min(1.8, Number.isFinite(rawScale) ? rawScale : 1))
  }, [playerSize.height, playerSize.width])

  const subtitleFontSize = Math.max(10, Math.round(settings.subtitleFontSize * subtitleScale))
  const subtitleBottomOffset = Math.max(44, Math.round(playerSize.height * 0.085))
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
            color: cue.style?.color || settings.subtitleColor,
            backgroundColor: settings.subtitleBackground,
            fontWeight: cue.style?.bold ? 'bold' : 'normal',
            fontStyle: cue.style?.italic ? 'italic' : 'normal',
            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            whiteSpace: 'pre-line'
          }}
        >
          {cue.text}
        </div>
      ))}
    </div>
  )
}
