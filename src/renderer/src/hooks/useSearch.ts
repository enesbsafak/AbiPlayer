import { useState, useEffect, useRef, useCallback } from 'react'

export function useSearch(onSearch: (query: string) => void, debounceMs = 300) {
  const [query, setQuery] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onSearch(query)
    }, debounceMs)

    return () => clearTimeout(timerRef.current)
  }, [query, debounceMs, onSearch])

  const reset = useCallback(() => setQuery(''), [])

  return { query, setQuery, reset }
}
