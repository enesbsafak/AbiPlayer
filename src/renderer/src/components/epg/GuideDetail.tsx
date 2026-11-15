import { PRIMARY_PILL } from '@/components/home/home-ui'
import { ArrowRightIcon, PlayIcon, StarIcon } from '@/components/ui/icons'
import type { CatalogItem } from '@/catalog/types'
import type { EPGProgram } from '@/types/epg'
import { strings } from '@/strings'
import { clockLocativeSuffix } from '@/strings/epg'
import { MINUTE_MS, programProgress, programTiming } from './guide-model'

const text = strings.epg

interface GuideDetailProps {
  channel: CatalogItem
  program: EPGProgram
  favorite: boolean
  now: number
  formatTime: (ts: number) => string
  /** The 12-hour setting: its times ("9:30 ÖS") are not read with a suffix. */
  twelveHour: boolean
  onPlay: () => void
}

const CHIP = 'flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-bold'

/**
 * The strip above the timeline: the focused programme's channel, title and
 * time, how far it has got when it is on now, and the screen's one primary
 * action, which plays the channel ("İzle" while the programme is on, "Kanalı
 * aç" otherwise: the channel plays live either way).
 */
export function GuideDetail({ channel, program, favorite, now, formatTime, twelveHour, onPlay }: GuideDetailProps) {
  const timing = programTiming(program, now)
  const time = text.timeRange(formatTime(program.start), formatTime(program.end))
  const progress = Math.round(programProgress(program, now))
  const startDate = new Date(program.start)
  const suffix = twelveHour ? null : clockLocativeSuffix(startDate.getHours(), startDate.getMinutes())
  const live = timing === 'live'

  return (
    <section
      aria-labelledby="epg-focused-title"
      className="flex min-h-[140px] shrink-0 flex-wrap items-center gap-x-7 gap-y-3 rounded-tile bg-raised px-7 py-4 short:min-h-0 short:px-6 short:py-3"
    >
      <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-2 short:gap-1">
        <div className="flex h-[26px] min-w-0 items-center gap-2.5">
          <span className="truncate text-[17px] font-bold">{channel.name}</span>
          {favorite && (
            <StarIcon size={18} role="img" aria-hidden={false} aria-label={text.favoriteChannel} className="shrink-0 fill-sun text-sun" />
          )}
          {live ? (
            <span className={`${CHIP} ml-1 bg-coral text-ink`}>
              <span aria-hidden="true" className="size-2 rounded-full bg-ink" />
              {text.onNow}
            </span>
          ) : (
            <span className={`${CHIP} ml-1 bg-ground text-white`}>{timing === 'upcoming' ? text.upNext : text.ended}</span>
          )}
        </div>
        <h2
          id="epg-focused-title"
          className="font-title truncate pb-[0.08em] text-[clamp(28px,3.1vw,40px)] leading-[1.1] short:text-[28px]"
          title={program.title}
        >
          {program.title}
        </h2>
        {live && (
          <div className="flex h-6 min-w-0 items-center gap-4">
            <span className="whitespace-nowrap text-[17px] font-bold tabular-nums">{time}</span>
            <div
              role="progressbar"
              aria-label={text.progress(program.title)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-3 min-w-20 flex-[0_1_420px] overflow-hidden rounded-full bg-white/20"
            >
              <div className="h-full rounded-full bg-sun" style={{ width: `${progress}%` }} />
            </div>
            <span className="whitespace-nowrap text-[17px] font-bold">{text.timeLeft(Math.ceil((program.end - now) / MINUTE_MS))}</span>
          </div>
        )}
        {timing === 'upcoming' && (
          <div className="flex h-6 min-w-0 items-baseline gap-3.5">
            <span className="whitespace-nowrap text-xl font-bold text-sun">{text.startsAt(formatTime(program.start), suffix)}</span>
            <span className="truncate text-base tabular-nums text-surface-400">
              {time} · {text.startsIn(Math.ceil((program.start - now) / MINUTE_MS))}
            </span>
          </div>
        )}
        {timing === 'ended' && (
          <div className="flex h-6 items-center">
            <span className="whitespace-nowrap text-[17px] font-bold tabular-nums">{time}</span>
          </div>
        )}
        {program.description && <p className="truncate text-[15px] text-surface-500 short:hidden">{program.description}</p>}
      </div>
      <button type="button" onClick={onPlay} className={`${PRIMARY_PILL} shrink-0`}>
        {live ? <PlayIcon size={22} /> : <ArrowRightIcon size={22} />}
        {live ? text.watch : text.openChannel}
      </button>
    </section>
  )
}
