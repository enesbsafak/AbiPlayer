import { useStore } from '@/store'

export function SubtitleOverlay() {
  const { activeSubtitleCues, settings } = useStore()

  if (activeSubtitleCues.length === 0) return null

  return (
    <div className="absolute inset-x-0 bottom-16 flex flex-col items-center gap-1 px-8 pointer-events-none">
      {activeSubtitleCues.map((cue, i) => (
        <div
          key={i}
          className="rounded px-3 py-1 text-center leading-relaxed max-w-[80%]"
          style={{
            fontSize: `${settings.subtitleFontSize}px`,
            color: cue.style?.color || settings.subtitleColor,
            backgroundColor: settings.subtitleBackground,
            fontWeight: cue.style?.bold ? 'bold' : 'normal',
            fontStyle: cue.style?.italic ? 'italic' : 'normal',
            textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
          }}
          dangerouslySetInnerHTML={{ __html: cue.text.replace(/\n/g, '<br/>') }}
        />
      ))}
    </div>
  )
}
