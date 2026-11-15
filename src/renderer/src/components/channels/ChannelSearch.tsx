import { CloseIcon, SearchIcon } from '@/components/ui/icons'
import { strings } from '@/strings'

interface ChannelSearchProps {
  value: string
  onSearch: (query: string) => void
  ariaLabel?: string
  placeholder?: string
}

/** The search field of a catalog page: a raised 52 px pill, as in the top bars. */
export function ChannelSearch({
  value,
  onSearch,
  ariaLabel = strings.catalog.types.live.search,
  placeholder = strings.catalog.types.live.searchPlaceholder
}: ChannelSearchProps) {
  return (
    <div className="flex h-[52px] items-center gap-3 rounded-full bg-raised pl-5 pr-2 text-white focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-[3px] focus-within:outline-sun">
      <SearchIcon size={22} className="shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => onSearch(e.target.value)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-surface-500 focus-visible:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onSearch('')}
          aria-label={strings.catalog.page.clearSearch}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-surface-400 transition-colors hover:bg-surface-800 hover:text-white"
        >
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  )
}
