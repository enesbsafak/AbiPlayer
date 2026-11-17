import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { isPlayableChannel } from '@/services/playback'
import { openPlayerFromRoute } from '@/services/player-navigation'
import type { Channel } from '@/types/playlist'
import type { PlaybackRequest } from '@/types/player'

export interface OpenCatalogItemContext {
  /** Route state the player hands back when the viewer leaves it. */
  returnState?: unknown
  /** Extra state for /series alongside the series to open. */
  seriesRouteState?: Record<string, unknown>
}

export type CatalogItemOpenPlan =
  | { kind: 'play' }
  | { kind: 'series'; state: Record<string, unknown> }
  /** An add-on film or series: its detail on its page, where its stream is chosen. */
  | { kind: 'addon-detail'; path: '/vod' | '/series'; state: Record<string, unknown> }
  | { kind: 'series-list' }
  | { kind: 'none' }

/**
 * What clicking a catalog card should do. A series is not a stream: it opens
 * its own detail page on /series, which reads `restoreSelectedSeries`.
 * Home and Favorites used to land on the generic series list instead. An
 * add-on film or series opens its detail too: its stream is chosen among
 * the add-ons' candidates from there.
 */
export function planCatalogItemOpen(
  channel: Channel,
  context: OpenCatalogItemContext = {}
): CatalogItemOpenPlan {
  if (channel.addonMetaId !== undefined && channel.type !== 'live') {
    return {
      kind: 'addon-detail',
      path: channel.type === 'series' ? '/series' : '/vod',
      state: {
        ...context.seriesRouteState,
        restoreDetail: { itemId: channel.id, sourceId: channel.sourceId, addonMetaId: channel.addonMetaId }
      }
    }
  }
  if (isPlayableChannel(channel)) return { kind: 'play' }
  if (channel.type !== 'series') return { kind: 'none' }
  if (typeof channel.seriesId !== 'number') return { kind: 'series-list' }

  return {
    kind: 'series',
    state: {
      ...context.seriesRouteState,
      restoreSelectedSeries: { seriesId: channel.seriesId, sourceId: channel.sourceId }
    }
  }
}

/**
 * Opens the player for what was just started, remembering the current route
 * to come back to (the add-on stream picker starts playback by itself).
 */
export function useOpenPlayerRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const setPlayerReturnTarget = useStore((s) => s.setPlayerReturnTarget)

  return useCallback(
    (context: Pick<OpenCatalogItemContext, 'returnState'> = {}) => {
      setMiniPlayer(false)
      openPlayerFromRoute({ location, navigate, returnState: context.returnState, setPlayerReturnTarget })
    },
    [location, navigate, setMiniPlayer, setPlayerReturnTarget]
  )
}

/**
 * Starts a playback request (a target plus what to show for it) and opens the
 * player, remembering the current route to come back to.
 */
export function useOpenPlayback() {
  const location = useLocation()
  const navigate = useNavigate()
  const startPlayback = useStore((s) => s.startPlayback)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const setPlayerReturnTarget = useStore((s) => s.setPlayerReturnTarget)

  return useCallback(
    (request: PlaybackRequest, context: Pick<OpenCatalogItemContext, 'returnState'> = {}) => {
      startPlayback(request)
      setMiniPlayer(false)
      openPlayerFromRoute({
        location,
        navigate,
        returnState: context.returnState,
        setPlayerReturnTarget
      })
    },
    [location, navigate, startPlayback, setMiniPlayer, setPlayerReturnTarget]
  )
}

/** One click handler for catalog cards outside the catalog pages. */
export function useOpenCatalogItem() {
  const location = useLocation()
  const navigate = useNavigate()
  const playChannel = useStore((s) => s.playChannel)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const setPlayerReturnTarget = useStore((s) => s.setPlayerReturnTarget)

  return useCallback(
    (channel: Channel, context: OpenCatalogItemContext = {}) => {
      const plan = planCatalogItemOpen(channel, context)
      switch (plan.kind) {
        case 'play':
          playChannel(channel)
          setMiniPlayer(false)
          openPlayerFromRoute({
            location,
            navigate,
            returnState: context.returnState,
            setPlayerReturnTarget
          })
          return
        case 'series':
          void navigate('/series', { state: plan.state })
          return
        case 'addon-detail':
          void navigate(plan.path, { state: plan.state })
          return
        case 'series-list':
          void navigate('/series')
          return
        case 'none':
          return
      }
    },
    [location, navigate, playChannel, setMiniPlayer, setPlayerReturnTarget]
  )
}
