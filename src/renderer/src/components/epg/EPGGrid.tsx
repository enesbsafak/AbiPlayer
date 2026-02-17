import { useState, useMemo, useRef } from 'react'
import { format, addHours, startOfHour } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/Button'

const HOUR_WIDTH = 240
const ROW_HEIGHT = 56
const HEADER_HEIGHT = 40
const CHANNEL_WIDTH = 180

export function EPGGrid() {
  const { epgData, channels } = useStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [timeOffset, setTimeOffset] = useState(0)

  const baseTime = useMemo(() => startOfHour(new Date()), [])
  const startTime = addHours(baseTime, timeOffset).getTime()
  const endTime = addHours(baseTime, timeOffset + 4).getTime()
  const totalWidth = HOUR_WIDTH * 4

  const liveChannels = useMemo(
    () => channels.filter((c) => c.type === 'live' && c.epgChannelId),
    [channels]
  )

  if (!epgData || liveChannels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-surface-500">
        <p className="text-lg">No EPG data available</p>
        <p className="text-sm mt-1">EPG data will load automatically when connected to an Xtream source</p>
      </div>
    )
  }

  const hours = Array.from({ length: 4 }, (_, i) => addHours(baseTime, timeOffset + i))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="sm" onClick={() => setTimeOffset((t) => t - 4)}>
          <ChevronLeft size={16} /> Earlier
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setTimeOffset(0)}>Now</Button>
        <Button variant="ghost" size="sm" onClick={() => setTimeOffset((t) => t + 4)}>
          Later <ChevronRight size={16} />
        </Button>
        <span className="text-sm text-surface-400 ml-2">
          {format(new Date(startTime), 'MMM d, HH:mm')} - {format(new Date(endTime), 'HH:mm')}
        </span>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-surface-800" ref={scrollRef}>
        <div style={{ minWidth: CHANNEL_WIDTH + totalWidth }}>
          {/* Time header */}
          <div className="sticky top-0 z-10 flex bg-surface-900 border-b border-surface-800">
            <div className="shrink-0 border-r border-surface-800" style={{ width: CHANNEL_WIDTH, height: HEADER_HEIGHT }} />
            {hours.map((h, i) => (
              <div
                key={i}
                className="shrink-0 border-r border-surface-800 px-3 flex items-center text-xs text-surface-400"
                style={{ width: HOUR_WIDTH, height: HEADER_HEIGHT }}
              >
                {format(h, 'HH:mm')}
              </div>
            ))}
          </div>

          {/* Channel rows */}
          {liveChannels.map((channel) => {
            const programs = epgData.programs[channel.epgChannelId!] || []
            const visiblePrograms = programs.filter((p) => p.end > startTime && p.start < endTime)

            return (
              <div key={channel.id} className="flex border-b border-surface-800/50" style={{ height: ROW_HEIGHT }}>
                <div className="shrink-0 flex items-center gap-2 border-r border-surface-800 px-3 bg-surface-900/50" style={{ width: CHANNEL_WIDTH }}>
                  <span className="truncate text-xs font-medium">{channel.name}</span>
                </div>
                <div className="relative flex-1" style={{ width: totalWidth }}>
                  {visiblePrograms.map((prog, i) => {
                    const progStart = Math.max(prog.start, startTime)
                    const progEnd = Math.min(prog.end, endTime)
                    const left = ((progStart - startTime) / (endTime - startTime)) * totalWidth
                    const width = ((progEnd - progStart) / (endTime - startTime)) * totalWidth
                    const isNow = Date.now() >= prog.start && Date.now() < prog.end

                    return (
                      <div
                        key={i}
                        className={`absolute top-1 bottom-1 rounded px-2 flex items-center overflow-hidden text-xs border transition-colors cursor-pointer hover:brightness-110 ${
                          isNow
                            ? 'bg-accent/20 border-accent/30 text-white'
                            : 'bg-surface-800 border-surface-700 text-surface-300'
                        }`}
                        style={{ left, width: Math.max(width, 2) }}
                        title={`${prog.title}\n${prog.description || ''}`}
                      >
                        <span className="truncate">{prog.title}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
