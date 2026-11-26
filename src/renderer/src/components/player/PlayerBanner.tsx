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

/** The number fits its 48 px tile at any length: longer numbers get a smaller face. */
function numberSize(digits: number): string {
  if (digits <= 2) return 'text-[28px]'
  if (digits === 3) return 'text-[22px]'
  if (digits === 4) return 'text-[17px]'
  return 'text-[14px]'
}

/** The title of the banner: the display face, one 30 px line. */
const BANNER_TITLE = 'font-title min-w-0 truncate text-[24px] leading-[30px]'

/** The smaller text beside the title and on the line under it. */
const DETAIL = 'text-[15px]'

interface LiveBannerProps {
  onJumpToLive: () => void
}

/**
 * Live TV: the channel's number in a coral tile; beside it the programme on
 * air (else the channel's name) with what comes next at the far end, and
 * under it the channel, the "Canlı" mark (which takes you back to the live
 * edge once you have fallen behind) and, when the guide knows the channel,
 * the programme's times with a progress bar.
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
  const title = onAir ? onAir.title : channel.name

  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <div className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-2xl bg-coral px-1.5 text-ink">
        {number !== null ? (
          <span className={`font-title tabular-nums ${numberSize(String(number).length)}`}>{number}</span>
        ) : (
          <LiveIcon size={24} />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-4">
          <p className={`${BANNER_TITLE} flex-1`} title={title}>
            {title}
          </p>
          {next && (size === 'l' || size === 'm') && (
            <p className={`max-w-[320px] shrink-0 truncate text-surface-500 ${DETAIL}`} title={next.title}>
              {dock.upNext(formatClockTime(next.start), next.title)}
            </p>
          )}
        </div>
        <div className={`flex min-w-0 items-center gap-3 ${DETAIL}`}>
          {smallLine && <p className="min-w-0 truncate font-bold">{smallLine}</p>}
          <button
            type="button"
            onClick={onJumpToLive}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full pl-2.5 pr-3 text-[14px] font-bold transition-colors ${
              isBehindLive ? 'border-2 border-white/50 text-white hover:border-white' : 'bg-coral text-ink'
            }`}
            title={liveLabel}
            aria-label={liveLabel}
          >
            <span aria-hidden="true" className={`size-2 rounded-full ${isBehindLive ? 'bg-white' : 'bg-ink'}`} />
            {isBehindLive ? text.transport.jumpToLive : text.transport.liveBadge}
          </button>
          {onAir && (
            <>
              <span className="shrink-0 font-bold tabular-nums">{formatClockTime(onAir.start)}</span>
              <div
                role="img"
                aria-label={dock.programmeProgress(percent)}
                className="h-2 min-w-[48px] max-w-[460px] flex-1 overflow-hidden rounded-full bg-white/20"
              >
                <div className="h-full rounded-full bg-coral" style={{ width: `${percent}%` }} />
              </div>
              <span className="shrink-0 font-bold tabular-nums">{formatClockTime(onAir.end)}</span>
              <span className="min-w-0 truncate tabular-nums text-surface-500">{dock.minutesLeft(minutesLeft(onAir, now))}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface ProgressScrubberProps {
  name: string
  currentTime: number
  duration: number
  playbackEngine: string
  video: HTMLVideoElement | null
}

/**
 * The title line with the position, the length and the time left at its end
 * (the dragged time while the bar is held), then the seek bar.
 */
function ProgressScrubber({ name, currentTime, duration, playbackEngine, video }: ProgressScrubberProps) {
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
    <>
      <div className="flex min-w-0 items-baseline gap-3">
        <p className={`${BANNER_TITLE} flex-1 pr-1`} title={name}>
          {name}
        </p>
        <span className={`shrink-0 font-bold tabular-nums ${DETAIL}`}>
          {formatTime(shownTime)} / {formatTime(duration)}
        </span>
        {isFinite(remainingTime) && (
          <span className={`shrink-0 tabular-nums text-surface-500 ${DETAIL}`}>{dock.minutesLeft(Math.ceil(remainingTime / 60))}</span>
        )}
      </div>
      {/* The bar takes only its 8 px in the dock; the input reaches 10 px into the gaps either side, so it is still 28 px to grab. */}
      <PlayerRange
        min={0}
        max={duration}
        value={shownTime}
        className="-my-2.5"
        onPointerDown={scrubber.hold}
        onKeyDown={scrubber.hold}
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
    </>
  )
}

interface MediaBannerProps {
  video: HTMLVideoElement | null
}

/** Films and episodes: the title with the position, the length and the time left, then the seek bar. */
export function MediaBanner({ video }: MediaBannerProps) {
  const channel = useStore((s) => s.currentChannel)
  const currentTime = useStore((s) => s.currentTime)
  const duration = useStore((s) => s.duration)
  const playbackEngine = useStore((s) => s.playbackEngine)

  if (!channel) return null

  return (
    <div className="flex min-w-0 flex-col gap-2 px-1">
      {duration > 0 ? (
        <ProgressScrubber
          name={channel.name}
          currentTime={currentTime}
          duration={duration}
          playbackEngine={playbackEngine}
          video={video}
        />
      ) : (
        <p className={BANNER_TITLE} title={channel.name}>
          {channel.name}
        </p>
      )}
    </div>
  )
}
