import { useEffect, useRef } from 'react'

const EMPTY: readonly never[] = []

/**
 * Keeps the previously rendered list on screen while a foreground load briefly
 * empties it, so switching category/source doesn't flash an empty grid.
 *
 * Render only *reads* the refs; every write happens in the effect below, because
 * React may replay or discard a render and mutations from it would leak.
 *
 * The `isStale` read is what makes the effect-based writes safe: right after
 * `resetKey` changes the retained list still holds the previous scope's items,
 * and the effect that clears it has not run yet. Treating that render as stale
 * makes the hook fall through to `items`, so the previous category's channels
 * can never flash on screen — the exact glitch this hook exists to prevent.
 */
export function useRetainedListWhileLoading<T>(
  items: T[],
  loading: boolean,
  resetKey: string | null | undefined
): T[] {
  const retainedRef = useRef<T[]>(items)
  const previousResetKeyRef = useRef(resetKey)

  const isStale = previousResetKeyRef.current !== resetKey
  const retained = isStale ? (EMPTY as unknown as T[]) : retainedRef.current

  useEffect(() => {
    if (previousResetKeyRef.current !== resetKey) {
      previousResetKeyRef.current = resetKey
      retainedRef.current = []
      return
    }

    // Never capture the empty list we are trying to paper over.
    if (!(loading && items.length === 0)) {
      retainedRef.current = items
    }
  }, [items, loading, resetKey])

  if (loading && items.length === 0 && retained.length > 0) {
    return retained
  }

  return items
}
