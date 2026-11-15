import { useEffect, useRef } from 'react'
import {
  PERF_GLOBAL_KEY,
  PERF_LOCAL_STORAGE_KEY,
  PERF_QUERY_PARAM,
  createMpvProgressProbe,
  createPerfRecorder,
  describeXtreamUrl,
  isPerfFlag,
  type PerfDetail,
  type PerfTimeline
} from '../../../shared/perf'

// Renderer side of the F0-07 timing marks; see src/shared/perf.ts.

function readFlag(): boolean {
  try {
    if (isPerfFlag(new URLSearchParams(window.location.search).get(PERF_QUERY_PARAM))) return true
    return isPerfFlag(window.localStorage.getItem(PERF_LOCAL_STORAGE_KEY))
  } catch {
    return false
  }
}

const recorder = createPerfRecorder({
  process: 'renderer',
  enabled: typeof window !== 'undefined' && readFlag(),
  now: () => performance.now(),
  timeOrigin: performance.timeOrigin
})

export function perfMark(name: string, detail?: PerfDetail): void {
  recorder.mark(name, detail)
}

/** Request marks for `xtream-api.ts`: action only, never the credential-bearing URL. */
export function perfXtreamMark(name: string, url: string): void {
  if (!recorder.enabled) return
  recorder.mark(name, describeXtreamUrl(url))
}

function rendererTimeline(): PerfTimeline {
  const timeline = recorder.timeline()
  // Paint timing is recorded by the browser itself; fold it in at read time.
  for (const entry of performance.getEntriesByType('paint')) {
    timeline.marks.push({ name: `renderer:${entry.name}`, t: Math.round(entry.startTime * 100) / 100 })
  }
  timeline.marks.sort((a, b) => a.t - b.t)
  return timeline
}

if (recorder.enabled) {
  // Imported first by main.tsx, so this is "first line of main.tsx".
  recorder.mark('renderer:entry')
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) recorder.longTask(entry.startTime, entry.duration)
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    // Long task timing is unavailable; marks still work.
  }
  ;(window as unknown as Record<string, unknown>)[PERF_GLOBAL_KEY] = {
    timeline: rendererTimeline,
    table: () => console.table(recorder.summary())
  }
}

/** Marks once per mount, the first time `when` holds after a commit. */
export function usePerfMarkOnce(name: string, when = true): void {
  const doneRef = useRef(false)
  useEffect(() => {
    if (doneRef.current || !when) return
    doneRef.current = true
    perfMark(name)
  }, [name, when])
}

/** Marks every time `condition` turns from false to true. */
export function usePerfTransition(name: string, condition: boolean): void {
  const previousRef = useRef(condition)
  useEffect(() => {
    if (condition && !previousRef.current) perfMark(name)
    previousRef.current = condition
  }, [name, condition])
}

interface PerfStoreState {
  currentChannel: { type: string } | null
}

interface PerfStoreApi {
  persist: {
    hasHydrated(): boolean
    onFinishHydration(listener: () => void): () => void
  }
  subscribe(listener: (state: PerfStoreState, previous: PerfStoreState) => void): () => void
}

/**
 * Called once right after the store is created. Marks the end of creation and
 * of hydration (synchronous with localStorage, async through the backup
 * fallback), and every playback request at the moment it reaches the store.
 */
export function perfWatchStore(store: PerfStoreApi): void {
  if (!recorder.enabled) return
  perfMark('renderer:store-created')
  if (store.persist.hasHydrated()) {
    perfMark('renderer:store-hydrated')
  } else {
    const unsubscribe = store.persist.onFinishHydration(() => {
      unsubscribe()
      perfMark('renderer:store-hydrated')
    })
  }
  store.subscribe((state, previous) => {
    if (state.currentChannel && state.currentChannel !== previous.currentChannel) {
      perfMark('play:request', { type: state.currentChannel.type })
    }
  })
}

const mpvProbe = createMpvProgressProbe()

/** Call right before `mpvOpen(url)`. */
export function perfMpvOpen(url: string): void {
  if (!recorder.enabled) return
  mpvProbe.begin(url)
  perfMark('mpv:open-call')
}

/**
 * Feed each `mpv-state` snapshot main pushes. The main-side steps (process
 * spawn, pipe connect, observers, loadfile) cannot be marked from here; this
 * marks the first snapshot that shows the new stream advancing, which bounds
 * mpv's `playback-restart` from above by main's time-update coalescing
 * (one snapshot per 200 ms).
 */
export function perfMpvSnapshot(snapshot: { path: string | null; timePos: number }): void {
  if (!recorder.enabled) return
  if (mpvProbe.observe(snapshot)) perfMark('mpv:first-progress')
}
