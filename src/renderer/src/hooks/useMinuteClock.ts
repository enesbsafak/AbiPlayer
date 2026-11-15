import { useEffect, useState } from 'react'
import { LOCALE } from '@/strings'

const MINUTE_MS = 60_000

/** Milliseconds from `now` to the start of the next minute. */
export function msToNextMinute(now: number): number {
  return MINUTE_MS - (now % MINUTE_MS)
}

/**
 * The current time, updated on each minute boundary rather than on a fixed
 * interval from mount, so a clock showing it turns over when the system clock
 * does.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(Date.now())
        schedule()
      }, msToNextMinute(Date.now()) + 50)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
  return now
}

const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' })
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' })

/** "20:42". */
export function formatClockTime(epochMs: number): string {
  return timeFormat.format(epochMs)
}

/** "Cumartesi". */
export function formatWeekday(epochMs: number): string {
  return weekdayFormat.format(epochMs)
}
