import { useStore } from '@/store'
import { findCurrentProgram } from '@/services/epg-service'

interface NowPlayingProps {
  epgChannelId?: string
}

export function NowPlaying({ epgChannelId }: NowPlayingProps) {
  const epgData = useStore((s) => s.epgData)

  if (!epgChannelId || !epgData) return null

  const programs = epgData.programs[epgChannelId]
  const current = programs ? findCurrentProgram(programs) : null

  if (!current) return null

  const now = Date.now()
  const progress = ((now - current.start) / (current.end - current.start)) * 100

  return (
    <div className="mt-1">
      <p className="truncate text-xs text-surface-400">{current.title}</p>
      <div className="mt-1 h-0.5 w-full rounded-full bg-surface-700">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, progress)}%` }} />
      </div>
    </div>
  )
}
