import { Search, X } from 'lucide-react'
import { strings } from '@/strings'

interface ChannelSearchProps {
  value: string
  onSearch: (query: string) => void
  ariaLabel?: string
  placeholder?: string
}

export function ChannelSearch({
  value,
  onSearch,
  ariaLabel = strings.catalog.types.live.search,
  placeholder = strings.catalog.types.live.searchPlaceholder
}: ChannelSearchProps) {
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onSearch(e.target.value)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="w-full rounded-lg border border-surface-700 bg-surface-900 px-9 py-2 text-sm text-surface-50 placeholder:text-surface-500 transition-colors focus:border-surface-600 focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {value && (
        <button
          type="button"
          onClick={() => onSearch('')}
          aria-label={strings.catalog.page.clearSearch}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
