import { useCallback, useEffect, useState } from 'react'
import { catalog } from '@/catalog'
import { useStore } from '@/store'
import { adjacentEpisodes } from '@/store/player-slice'
import { m3uSeriesQueue } from '@/services/m3u-series'
import { xtreamApi } from '@/services/xtream-api'
import { episodeQueueOf, seriesDetailFromInfo } from '@/services/xtream-series'

/** How long the "next episode" card counts down before the episode starts. */
export const NEXT_EPISODE_COUNTDOWN_S = 6

/**
 * An episode started without its series' episode list (the "continue" row of
 * the home page plays it straight from the history) gets the list loaded
 * here, so "next" and "previous" work for it too: from the account for an
 * Xtream episode, from the loaded playlist for one gathered from an M3U
 * list. Quiet on failure: the buttons then stay disabled, as they are for an
 * episode whose series is not known.
 */
export function useEpisodeQueueLoader(): void {
  const sourceId = useStore((s) => (s.currentPlayback?.target.kind === 'episode' ? s.currentPlayback.target.sourceId : null))
  const seriesId = useStore((s) => (s.currentPlayback?.target.kind === 'episode' ? s.currentPlayback.target.seriesId : null))
  const seriesRef = useStore((s) => (s.currentPlayback ? (s.currentChannel?.seriesRef ?? null) : null))
  const missing = useStore((s) => s.episodeQueue === null)
  // The account's password may still be on its way from the secure store.
  const credentialsHydrated = useStore((s) => s.credentialsHydrated)

  useEffect(() => {
    if (seriesRef === null || !missing) return
    const series = catalog.getItem(seriesRef)
    if (series) useStore.getState().setEpisodeQueue(m3uSeriesQueue(series))
  }, [seriesRef, missing])

  useEffect(() => {
    if (sourceId === null || seriesId === null || !missing) return
    const state = useStore.getState()
    const creds = state.getXtreamCredentials(sourceId)
    if (!creds) return
    const controller = new AbortController()
    void xtreamApi.getSeriesInfo(creds, seriesId, { signal: controller.signal }).then(
      (info) => {
        if (controller.signal.aborted) return
        const { detail } = seriesDetailFromInfo(info, seriesId, (episodeId, extension) =>
          xtreamApi.buildSeriesUrl(creds, episodeId, extension)
        )
        useStore.getState().setEpisodeQueue(episodeQueueOf(sourceId, detail))
      },
      () => undefined
    )
    return () => controller.abort()
  }, [sourceId, seriesId, missing, credentialsHydrated])
}

export interface NextEpisodeCountdown {
  title: string
  secondsLeft: number
  playNow: () => void
  cancel: () => void
}

/**
 * The episode that follows the one that just ended: counts down and starts
 * it, unless the viewer starts it at once or calls it off. Null while nothing
 * ended, when the series has no further episode, and once called off.
 */
export function useNextEpisodeCountdown(): NextEpisodeCountdown | null {
  const endedPlaybackId = useStore((s) => (s.endedPlaybackId !== null && s.endedPlaybackId === s.currentPlayback?.playbackId ? s.endedPlaybackId : null))
  const next = useStore((s) => (s.currentPlayback ? adjacentEpisodes(s.episodeQueue, s.currentPlayback.mediaKey).next : null))
  const playQueued = useStore((s) => s.playQueued)
  const [cancelledFor, setCancelledFor] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<{ playbackId: string; secondsLeft: number } | null>(null)

  const active = endedPlaybackId !== null && next !== null && cancelledFor !== endedPlaybackId
  const activeId = active ? endedPlaybackId : null

  useEffect(() => {
    if (activeId === null) {
      setCountdown(null)
      return
    }
    setCountdown({ playbackId: activeId, secondsLeft: NEXT_EPISODE_COUNTDOWN_S })
    const timer = window.setInterval(() => {
      setCountdown((current) =>
        current && current.playbackId === activeId ? { ...current, secondsLeft: Math.max(0, current.secondsLeft - 1) } : current
      )
    }, 1000)
    return () => window.clearInterval(timer)
  }, [activeId])

  const playNow = useCallback(() => {
    if (next) playQueued(next)
  }, [next, playQueued])

  const cancel = useCallback(() => setCancelledFor(endedPlaybackId), [endedPlaybackId])

  const secondsLeft = countdown && countdown.playbackId === activeId ? countdown.secondsLeft : null
  useEffect(() => {
    if (secondsLeft === 0) playNow()
  }, [secondsLeft, playNow])

  if (!active || !next || secondsLeft === null) return null
  return { title: next.title, secondsLeft, playNow, cancel }
}
