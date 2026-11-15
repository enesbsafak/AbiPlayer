import { useMemo } from 'react'
import { LiveIcon } from '@/components/ui/icons'
import { useStore } from '@/store'
import { useSeekScrubber } from '@/hooks/useSeekScrubber'
import { formatClockTime, useMinuteClock } from '@/hooks/useMinuteClock'
import { mpvSeekTo } from '@/services/platform'
import { strings } from '@/strings'
import { PlayerRange } from './PlayerRange'
import { formatTime, useDockLayout } from './player-ui'
import { minutesLeft, onAirFor, programmeShare, useChannelNumber, useSourceGuide } from './player-guide'

const text = strings.player
const dock = strings.player.dock

/** The number fits its 72 px tile at any length: longer numbers get a smaller face. */
function numberSize(digits: number): string {
  if (digits <= 2) return 'text-[44px] short:text-[34px]'
  if (digits === 3) return 'text-[34px] short:text-[26px]'
  if (digits === 4) return 'text-[26px] short:text-[20px]'
  return 'text-[21px] short:text-[16px]'
}

/** The title line of the banner: the display face, one line. */
const BANNER_TITLE = 'font-title min-w-0 truncate pb-0.5 text-[40px] leading-[1.1] short:text-[28px]'

interface LiveBannerProps {
  onJumpToLive: () => void
}

/**
 * Live TV: the channel's number in a coral tile, its name and the "Canlı"
 * mark (which takes you back to the live edge once you have fallen behind),
 * and, when the guide knows the channel, the programme on air with its times,
 * a thick progress bar, and what comes next.
 */
export function LiveBanner({ onJumpToLive }: LiveBannerProps) {
  const channel = useStore((s) => s.currentChannel)
  const isPaused = useStore((s) => s.isPaused)
  const isBuffering = useStore((s) => s.isBuffering)
  const { size } = useDockLayout()
  const number = useChannelNumber(channel)
  const guide = useSourceGuide(channel?.sourceId)
  const now = useMinuteClock()
  const { now: onAir, next } = useMemo(() => onAirFor(guide, channel, now), [guide, channel, now])

  if (!channel) return null

  // "Behind live": the user paused (the gap grows while paused) or the engine is
  // stalled and will resume behind the edge. Deliberately not derived from the
  // demuxer cache size, which doesn't map cleanly to drift during steady play.
  const isBehindLive = isPaused || isBuffering
  const liveLabel = isBehindLive ? text.transport.jumpToLive : text.transport.atLive
  const share = onAir ? programmeShare(onAir, now) : 0
  const percent = Math.round(share * 100)
  const smallLine = onAir ? channel.name : channel.categoryName

  return (
    <div className="flex min-w-0 items-center gap-[18px] short:gap-3.5">
      <div className="flex h-[72px] min-w-[72px] shrink-0 items-center justify-center rounded-[22px] bg-coral px-2 text-ink short:h-14 short:min-w-14 short:rounded-[18px]">
        {number !== null ? (
          <span className={`font-title tabular-nums ${numberSize(String(number).length)}`}>{number}</span>
        ) : (
          <LiveIcon size={34} />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 short:gap-0.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {smallLine && <p className="min-w-0 truncate text-[17px] font-bold short:text-[15px]">{smallLine}</p>}
          <button
            type="button"
            onClick={onJumpToLive}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full pl-2.5 pr-3 text-[14px] font-bold transition-colors ${
              isBehindLive ? 'border-2 border-white/50 text-white hover:border-white' : 'bg-coral text-ink'
            }`}
            title={liveLabel}
            aria-label={liveLabel}
          >
            <span aria-hidden="true" className={`size-2 rounded-full ${isBehindLive ? 'bg-white' : 'bg-ink'}`} />
            {isBehindLive ? text.transport.jumpToLive : text.transport.liveBadge}
          </button>
        </div>
        <p className={BANNER_TITLE} title={onAir ? onAir.title : channel.name}>
          {onAir ? onAir.title : channel.name}
        </p>
        {onAir && (
          <div className="mt-0.5 flex min-w-0 items-center gap-3 text-[15px] tabular-nums">
            <span className="shrink-0 font-bold">{formatClockTime(onAir.start)}</span>
            <div
              role="img"
              aria-label={dock.programmeProgress(percent)}
              className="h-3 min-w-[48px] max-w-[460px] flex-1 overflow-hidden rounded-full bg-white/20"
            >
              <div className="h-full rounded-full bg-coral" style={{ width: `${percent}%` }} />
            </div>
            <span className="shrink-0 font-bold">{formatClockTime(onAir.end)}</span>
            <span className="min-w-0 truncate text-surface-500">{dock.minutesLeft(minutesLeft(onAir, now))}</span>
          </div>
        )}
      </div>

      {next && (size === 'l' || size === 'm') && (
        <div className="flex w-60 shrink-0 flex-col gap-1 rounded-card bg-raised px-[18px] py-3.5 short:py-2.5">
          <p className="text-[14px] font-medium tabular-nums text-surface-500">{dock.upNext(formatClockTime(next.start))}</p>
          <p className="truncate text-[17px] font-bold" title={next.title}>{next.title}</p>
        </div>
      )}
    </div>
  )
}

interface ProgressScrubberProps {
  currentTime: number
  duration: number
  playbackEngine: string
  video: HTMLVideoElement | null
}

function ProgressScrubber({ currentTime, duration, playbackEngine, video }: ProgressScrubberProps) {
  const scrubber = useSeekScrubber(currentTime, (t) => {
    if (playbackEngine === 'mpv') {
      void mpvSeekTo(t).catch(() => undefined)
    } else if (video) {
      video.currentTime = t
    }
  })
  const shownTime = scrubber.value
  const remainingTime = Math.max(0, duration - shownTime)

  return (
    <div className="flex min-w-0 items-center gap-3 text-[15px] tabular-nums">
      <span className="shrink-0 font-bold">{formatTime(shownTime)}</span>
      <PlayerRange
        min={0}
        max={duration}
        value={shownTime}
        thickness={12}
        className="flex-1"
        onChange={(e) => scrubber.update(parseFloat(e.target.value))}
        onPointerUp={scrubber.commit}
        onPointerCancel={scrubber.commit}
        onKeyUp={scrubber.commit}
        onBlur={scrubber.commit}
        aria-label={text.transport.progress}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shownTime)}
      />
      <span className="shrink-0 font-bold">{formatTime(duration)}</span>
      <span className="min-w-[92px] shrink-0 text-right text-surface-500">{dock.timeLeft(formatTime(remainingTime))}</span>
    </div>
  )
}

interface MediaBannerProps {
  video: HTMLVideoElement | null
}

/** Films and episodes: the title, then position, the seek bar, the length and the time left. */
export function MediaBanner({ video }: MediaBannerProps) {
  const channel = useStore((s) => s.currentChannel)
  const currentTime = useStore((s) => s.currentTime)
  const duration = useStore((s) => s.duration)
  const playbackEngine = useStore((s) => s.playbackEngine)

  if (!channel) return null

  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-1">
      <p className={BANNER_TITLE} title={channel.name}>
        {channel.name}
      </p>
      {duration > 0 && (
        <ProgressScrubber currentTime={currentTime} duration={duration} playbackEngine={playbackEngine} video={video} />
      )}
    </div>
  )
}
