import { useRef } from 'react'

export function useRetainedListWhileLoading<T>(
  items: T[],
  loading: boolean,
  resetKey: string | null | undefined
): T[] {
  const retainedRef = useRef<T[]>(items)
  const previousResetKeyRef = useRef(resetKey)

  if (previousResetKeyRef.current !== resetKey) {
    previousResetKeyRef.current = resetKey
    retainedRef.current = []
  }

  const shouldUseRetained = loading && items.length === 0 && retainedRef.current.length > 0

  if (shouldUseRetained) {
    return retainedRef.current
  }

  retainedRef.current = items
  return items
}
