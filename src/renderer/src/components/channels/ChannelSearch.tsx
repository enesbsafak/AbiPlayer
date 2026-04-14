import { useCallback, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { useSearch } from '@/hooks/useSearch'

interface ChannelSearchProps {
  value?: string
  onSearch: (query: string) => void
}

export function ChannelSearch({ value, onSearch }: ChannelSearchProps) {
  const lastReportedRef = useRef(value ?? '')
  const handleSearch = useCallback((q: string) => {
    lastReportedRef.current = q
    onSearch(q)
  }, [onSearch])
  const { query, setQuery } = useSearch(handleSearch, 300)

  useEffect(() => {
    if (typeof value !== 'string') return
    // Only sync when value changed externally (e.g. source switch, route restore),
    // not when it echoes back our own debounced report.
    if (value === lastReportedRef.current) return
    lastReportedRef.current = value
    setQuery(value)
  }, [value, setQuery])

  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Kanal ara..."
        className="w-full rounded-lg border border-surface-700 bg-surface-900 px-9 py-2 text-sm text-surface-50 placeholder:text-surface-500 transition-colors focus:border-surface-600 focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {query && (
        <button
          onClick={() => setQuery('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
