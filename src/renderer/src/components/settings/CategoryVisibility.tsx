import { useMemo, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Input } from '@/components/ui/Input'
import { normalizeSearchText } from '@/services/text-normalize'
import { useCatalogCategories, useVisibleCatalogCategories } from '@/catalog'
import { strings } from '@/strings'

const text = strings.settings.catalog

type ContentType = 'live' | 'vod' | 'series'

const TYPE_TABS: Array<{ id: ContentType; label: string }> = [
  { id: 'live', label: strings.catalog.types.live.section },
  { id: 'vod', label: strings.catalog.types.vod.section },
  { id: 'series', label: strings.catalog.types.series.section }
]

export function CategoryVisibility() {
  const sources = useStore((s) => s.sources)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const hiddenCategoryIds = useStore((s) => s.hiddenCategoryIds)
  const toggleCategoryHidden = useStore((s) => s.toggleCategoryHidden)
  const showAllCategories = useStore((s) => s.showAllCategories)

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(activeSourceId)
  const [selectedType, setSelectedType] = useState<ContentType>('live')
  const [filterQuery, setFilterQuery] = useState('')

  // Falls back to the active source so the panel is never empty just because
  // the user switched sources after this component first mounted.
  const effectiveSourceId =
    selectedSourceId && sources.some((s) => s.id === selectedSourceId)
      ? selectedSourceId
      : activeSourceId

  const sourceItems = useMemo(
    () => sources.map((source) => ({ id: source.id, label: source.name })),
    [sources]
  )

  const scopedCategories = useCatalogCategories(effectiveSourceId, selectedType)
  const ordered = useVisibleCatalogCategories(effectiveSourceId, selectedType, { includeHidden: true })
  const visibleList = useMemo(() => {
    if (!filterQuery.trim()) return ordered
    const q = normalizeSearchText(filterQuery)
    return ordered.filter((category) => normalizeSearchText(category.name).includes(q))
  }, [ordered, filterQuery])

  // Category ids carry their source's id as prefix, so this also counts hidden
  // categories of types not loaded this session (the button restores them too).
  const hiddenCountForSource = useMemo(() => {
    if (!effectiveSourceId) return 0
    const prefix = `${effectiveSourceId}_`
    let count = 0
    for (const id of hiddenCategoryIds) if (id.startsWith(prefix)) count++
    return count
  }, [effectiveSourceId, hiddenCategoryIds])

  if (sources.length === 0) {
    return (
      <p className="rounded-lg border border-surface-800 bg-surface-900 px-4 py-3 text-sm text-surface-400">
        {text.noSources}
      </p>
    )
  }

  return (
      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p className="text-sm font-medium text-surface-200">{text.visibility}</p>
        <p className="mt-1 text-sm text-surface-400">
          {text.visibilityHint}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {sources.length > 1 && (
            <div>
              <p id="category-source-label" className="text-sm text-surface-400 mb-2">
                {text.source}
              </p>
              <Dropdown
                id="category-source"
                labelledBy="category-source-label"
                items={sourceItems}
                value={effectiveSourceId ?? undefined}
                onSelect={(id) => setSelectedSourceId(id)}
                placeholder={text.sourcePlaceholder}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedType(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  selectedType === tab.id
                    ? 'border border-accent/45 bg-accent/15 text-accent'
                    : 'border border-surface-700 text-surface-400 hover:bg-surface-800 hover:text-surface-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <Input
            id="category-filter"
            type="search"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={text.filterPlaceholder}
            aria-label={text.filterLabel}
          />
        </div>

        <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-surface-800">
          {visibleList.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-surface-500">
              {scopedCategories.length > 0 ? text.noMatch : text.noCategories}
            </p>
          ) : (
            <ul className="divide-y divide-surface-800">
              {visibleList.map((category) => {
                const isHidden = hiddenCategoryIds.has(category.id)
                return (
                  <li key={category.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-800/50">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggleCategoryHidden(category.id)}
                        className="rounded border-surface-700 bg-surface-900 text-accent focus:ring-accent"
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${
                          isHidden ? 'text-surface-500 line-through' : 'text-surface-200'
                        }`}
                        title={category.name}
                      >
                        {category.name}
                      </span>
                      {category.isAdult && (
                        <span className="shrink-0 rounded bg-surface-800 px-1.5 py-0.5 text-xs text-surface-400">
                          {text.adultBadge}
                        </span>
                      )}
                      {isHidden ? (
                        <EyeOff size={14} className="shrink-0 text-surface-500" aria-label={text.hidden} />
                      ) : (
                        <Eye size={14} className="shrink-0 text-surface-600" aria-label={text.visible} />
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={hiddenCountForSource === 0}
            onClick={() => effectiveSourceId && showAllCategories(effectiveSourceId)}
          >
            {text.showAllHidden}
          </Button>
          <span className="text-xs text-surface-500">
            {text.hiddenCount(hiddenCountForSource)}
          </span>
        </div>
      </div>
  )
}
