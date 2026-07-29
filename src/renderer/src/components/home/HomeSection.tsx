import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import { Button } from '@/components/ui/Button'
import type { Channel } from '@/types/playlist'

interface HomeSectionProps {
  title: string
  icon: LucideIcon
  iconClassName?: string
  /** Route the "Tümünü Gör" button navigates to. */
  viewAllTo: string
  channels: Channel[]
  onPlay: (channel: Channel) => void
}

/**
 * One dashboard row (Favoriler / Canlı TV / Filmler / Diziler). These were four
 * copies of the same markup; keeping them as one component means a change to
 * the row layout can't drift between them.
 *
 * Renders nothing when empty, so callers don't need a guard each.
 */
export function HomeSection({
  title,
  icon: Icon,
  iconClassName = 'text-accent',
  viewAllTo,
  channels,
  onPlay
}: HomeSectionProps) {
  const navigate = useNavigate()

  if (channels.length === 0) return null

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon size={20} className={iconClassName} /> {title}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => navigate(viewAllTo)}>
          Tümünü Gör
        </Button>
      </div>
      <ChannelGrid channels={channels} onPlay={onPlay} />
    </section>
  )
}
