import { Search, X } from 'lucide-react'
import { useSearch } from '@/hooks/useSearch'

interface ChannelSearchProps {
  onSearch: (query: string) => void
}

export function ChannelSearch({ onSearch }: ChannelSearchProps) {
  const { query, setQuery } = useSearch(onSearch, 300)

  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Kanal ara..."
        className="w-full rounded-xl border border-surface-600/35 bg-surface-900/70 px-9 py-2.5 text-sm text-surface-100 placeholder:text-surface-400 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/45"
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
