import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import { Button } from '@/components/ui/Button'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'

interface HomeSectionProps {
  title: string
  icon: LucideIcon
  iconClassName?: string
  /** Route the "Tümünü Gör" button navigates to. */
  viewAllTo: string
  channels: readonly Channel[]
  /**
   * Its preview is still on its way: an empty row keeps its place with a
   * placeholder, so rows that arrive first do not shift once it comes in.
   */
  loading?: boolean
  onPlay: (channel: Channel) => void
}

const PLACEHOLDER_CARDS = 6

/**
 * One dashboard row (Favoriler / Canlı TV / Filmler / Diziler). These were four
 * copies of the same markup; keeping them as one component means a change to
 * the row layout can't drift between them.
 *
 * Renders nothing when empty and not loading, so callers don't need a guard each.
 */
export function HomeSection({
  title,
  icon: Icon,
  iconClassName = 'text-accent',
  viewAllTo,
  channels,
  loading = false,
  onPlay
}: HomeSectionProps) {
  const navigate = useNavigate()

  if (channels.length === 0 && !loading) return null

  return (
    <section aria-busy={channels.length === 0 ? true : undefined}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon size={20} className={iconClassName} /> {title}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => void navigate(viewAllTo)}>
          {strings.catalog.home.viewAll}
        </Button>
      </div>
      {channels.length > 0 ? (
        <ChannelGrid channels={channels} onPlay={onPlay} ariaLabel={title} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3" aria-label={strings.catalog.home.rowLoading(title)}>
          {Array.from({ length: PLACEHOLDER_CARDS }, (_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-lg border border-surface-800 bg-surface-900" />
          ))}
        </div>
      )}
    </section>
  )
}
