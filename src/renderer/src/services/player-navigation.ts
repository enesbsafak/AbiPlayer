import type { Location, NavigateFunction } from 'react-router-dom'
import type { PlayerReturnTarget } from '@/types/navigation'

type LocationSnapshot = Pick<Location, 'pathname' | 'search' | 'hash'>

export function createPlayerReturnTarget(
  location: LocationSnapshot,
  state?: unknown
): PlayerReturnTarget {
  return {
    pathname: location.pathname,
    search: location.search || '',
    hash: location.hash || '',
    state: state ?? null
  }
}

export function openPlayerFromRoute({
  location,
  navigate,
  returnState,
  setPlayerReturnTarget
}: {
  location: LocationSnapshot
  navigate: NavigateFunction
  returnState?: unknown
  setPlayerReturnTarget: (target: PlayerReturnTarget | null) => void
}): void {
  setPlayerReturnTarget(createPlayerReturnTarget(location, returnState))
  navigate('/player')
}

export function navigateToPlayerReturnTarget({
  fallbackPath = '/',
  navigate,
  target
}: {
  fallbackPath?: string
  navigate: NavigateFunction
  target: PlayerReturnTarget | null
}): void {
  if (!target) {
    navigate(fallbackPath)
    return
  }

  navigate(
    {
      pathname: target.pathname,
      search: target.search || '',
      hash: target.hash || ''
    },
    { state: target.state ?? null }
  )
}
