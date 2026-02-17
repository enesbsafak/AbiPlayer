import { Search, X } from 'lucide-react'
import { useSearch } from '@/hooks/useSearch'

interface ChannelSearchProps {
  onSearch: (query: string) => void
}

export function ChannelSearch({ onSearch }: ChannelSearchProps) {
  const { query, setQuery } = useSearch(onSearch, 300)

  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search channels..."
        className="w-full rounded-lg border border-surface-700 bg-surface-800 pl-9 pr-8 py-2 text-sm text-white placeholder:text-surface-500 focus:border-accent focus:outline-none transition-colors"
      />
      {query && (
        <button
          onClick={() => setQuery('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-surface-700 text-surface-500"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
