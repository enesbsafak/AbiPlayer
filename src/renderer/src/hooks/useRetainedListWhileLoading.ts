import { useEffect, useRef } from 'react'

export function useRetainedListWhileLoading<T>(
  items: T[],
  loading: boolean,
  resetKey: string | null | undefined
): T[] {
  const retainedRef = useRef<T[]>(items)
  const previousResetKeyRef = useRef(resetKey)

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return
    previousResetKeyRef.current = resetKey
    retainedRef.current = []
  }, [resetKey])

  useEffect(() => {
    if (!loading || items.length > 0) {
      retainedRef.current = items
    }
  }, [items, loading])

  if (loading && items.length === 0 && retainedRef.current.length > 0) {
    return retainedRef.current
  }

  return items
}
