import { useState } from 'react'
import { FavoriteToggle } from '@/components/ui/FavoriteToggle'
import { PlayIcon } from '@/components/ui/icons'
import { formatClockTime } from '@/hooks/useMinuteClock'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'
import { channelInitial, minutesLeft, programmeProgress, type ChannelGuide } from './live-guide'

const text = strings.catalog.live

interface LiveChannelPanelProps {
  channel: Channel
  guide: ChannelGuide | null
  now: number
  onPlay: (channel: Channel) => void
}

/**
 * The panel's picture: the logo large on the raised surface once it has
 * loaded; until then, and for a channel without a logo (or one that does not
 * load), the channel's initial in the display face on coral. Never an empty box.
 */
function ChannelArt({ channel }: { channel: Channel }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const logo = channel.logo && failed !== channel.logo ? channel.logo : null
  const showLogo = !!logo && loaded === logo
  return (
    <div
      className={`relative flex h-[200px] shrink-0 items-center justify-center overflow-hidden rounded-tile ${
        showLogo ? 'bg-raised' : 'bg-coral text-ink'
      }`}
    >
      {!showLogo && (
        <span aria-hidden="true" className="font-title text-[112px] leading-none">
          {channelInitial(channel.name)}
        </span>
      )}
      {logo && (
        <img
          key={logo}
          src={logo}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(logo)}
          onError={() => setFailed(logo)}
          className={`absolute inset-0 h-full w-full object-contain p-10 ${showLogo ? '' : 'invisible'}`}
        />
      )}
      <span
        className={`absolute left-4 top-4 flex h-[34px] items-center gap-2 rounded-full px-3.5 text-[15px] font-bold ${
          showLogo ? 'bg-coral text-ink' : 'bg-ink text-coral'
        }`}
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${showLogo ? 'bg-ink' : 'bg-coral'}`} />
        {strings.common.live}
      </span>
    </div>
  )
}

/**
 * The channel in focus, beside the list: its logo, what is on and how far it
 * has got, what comes next, and the screen's one primary action, "Bu kanalı
 * izle". Without a guide it says where programme information comes from.
 */
export function LiveChannelPanel({ channel, guide, now, onPlay }: LiveChannelPanelProps) {
  const onAir = guide?.now ?? null
  const next = guide?.next ?? null
  const progress = onAir ? programmeProgress(onAir, now) : null

  return (
    <section aria-label={text.panelLabel} className="flex min-h-0 flex-col gap-4 overflow-y-auto">
      <ChannelArt key={channel.id} channel={channel} />

      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="truncate text-lg font-bold" title={channel.name}>
          {channel.name}
        </p>
        {onAir ? (
          <>
            <h2 className="font-title line-clamp-2 pb-[0.1em] text-[clamp(26px,2.4vw,36px)] leading-[1.05]">{onAir.title}</h2>
            <p className="text-base tabular-nums text-surface-400">
              {text.range(formatClockTime(onAir.start), formatClockTime(onAir.end))}
            </p>
          </>
        ) : (
          <p className="text-base text-surface-400">{text.noGuide}</p>
        )}
      </div>

      {onAir && progress !== null && (
        <div className="flex items-center gap-4">
          <div role="img" aria-label={text.programmeShare(progress)} className="h-3 flex-1 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-coral" style={{ width: `${progress}%` }} />
          </div>
          <span className="whitespace-nowrap text-[17px] font-bold">
            {strings.catalog.home.remaining(minutesLeft(onAir, now))}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={() => onPlay(channel)}
        className="flex h-[60px] shrink-0 items-center justify-center gap-3 rounded-full bg-white px-8 text-xl font-bold text-ink transition-colors hover:bg-surface-300"
      >
        <PlayIcon size={22} />
        {text.watch}
      </button>
      <FavoriteToggle channelId={channel.id} item={channel} variant="button" className="justify-center" />

      {next && (
        <div className="flex h-12 min-w-0 shrink-0 items-center gap-3 rounded-card bg-raised px-[18px]">
          <span className="text-[15px] font-bold text-sun">{text.next}</span>
          <span className="text-[15px] font-bold tabular-nums">{formatClockTime(next.start)}</span>
          <span className="min-w-0 truncate text-[15px] text-surface-400">{next.title}</span>
        </div>
      )}

      <p className="text-sm text-surface-500">{text.hint}</p>
    </section>
  )
}
