import { History, Play, X } from 'lucide-react'
import { LazyImage } from '@/components/ui/LazyImage'
import { ClampText } from '@/components/ui'
import type { ContinueWatchingItem } from '@/services/watch-progress'
import { strings } from '@/strings'

const text = strings.catalog.home

interface ContinueWatchingSectionProps {
  entries: ContinueWatchingItem[]
  onPlay: (item: ContinueWatchingItem) => void
  onRemove: (key: string) => void
}

function formatRemaining(seconds: number): string {
  return text.remaining(Math.max(0, Math.round(seconds / 60)))
}

/**
 * Its own component rather than a `HomeSection`: that row renders `ChannelGrid`
 * cards, which have nowhere to put a progress bar or a remove control, and
 * bending them into it would touch every other catalog screen.
 */
export function ContinueWatchingSection({
  entries,
  onPlay,
  onRemove
}: ContinueWatchingSectionProps) {
  if (entries.length === 0) return null

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <History size={20} className="text-accent" /> {text.continueWatching}
        </h2>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {entries.map((item) => {
          const { entry } = item
          const percent = Math.min(100, Math.max(0, (entry.position / entry.duration) * 100))
          const artwork = entry.channel.coverUrl || entry.channel.logo

          return (
            <div
              key={entry.key}
              className="group relative overflow-hidden rounded-lg border border-surface-800 bg-surface-900 transition-colors hover:border-surface-700"
            >
              <button
                type="button"
                onClick={() => onPlay(item)}
                className="flex w-full flex-col text-left"
                aria-label={text.resume(entry.channel.name)}
              >
                <div className="relative aspect-[2/3] bg-surface-800">
                  <LazyImage src={artwork} alt={entry.channel.name} className="h-full w-full" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
                    <Play
                      size={32}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      fill="white"
                      color="white"
                    />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
                    <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
                  </div>
                </div>
                <div className="p-3">
                  <ClampText
                    as="p"
                    lines={2}
                    titleText={entry.channel.name}
                    className="text-sm font-medium text-surface-100"
                  >
                    {entry.channel.name}
                  </ClampText>
                  <p className="mt-1 text-label text-surface-500">
                    {formatRemaining(entry.duration - entry.position)}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onRemove(entry.key)}
                aria-label={text.removeFromList(entry.channel.name)}
                title={text.removeFromListTitle}
                className="absolute right-2 top-2 rounded bg-surface-950/80 p-1 text-surface-400 opacity-0 transition-opacity hover:text-surface-50 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
