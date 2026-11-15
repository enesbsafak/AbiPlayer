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
  // A data router's navigate() resolves when the navigation settles and never
  // rejects (route errors go to the route's error element).
  void navigate('/player')
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
    void navigate(fallbackPath)
    return
  }

  void navigate(
    {
      pathname: target.pathname,
      search: target.search || '',
      hash: target.hash || ''
    },
    { state: target.state ?? null }
  )
}
