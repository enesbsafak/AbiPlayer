import { useMemo, useState } from 'react'
import { useStore } from '@/store'
import { Dropdown } from '@/components/ui/Dropdown'
import { normalizeSearchText } from '@/services/text-normalize'
import { useCatalogCategories, useVisibleCatalogCategories } from '@/catalog'
import { strings } from '@/strings'
import { ACTION, INPUT_CLASS, PillChoice, SettingRow, SettingsCard, SettingsGroup, Switch, type ChoiceOption } from './controls'

const text = strings.settings.catalog

type ContentType = 'live' | 'vod' | 'series'

/** Each type is filled with the colour of its section when chosen. */
const TYPE_TABS: Array<ChoiceOption<ContentType>> = [
  { id: 'live', label: strings.catalog.types.live.section, tone: 'coral' },
  { id: 'vod', label: strings.catalog.types.vod.section, tone: 'mint' },
  { id: 'series', label: strings.catalog.types.series.section, tone: 'sky' }
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
      <SettingsGroup title={text.visibility}>
        <p className="rounded-card bg-raised px-5 py-4 text-[15px] text-surface-300">{text.noSources}</p>
      </SettingsGroup>
    )
  }

  return (
    <SettingsGroup title={text.visibility}>
      <p className="-mt-1 text-sm text-surface-400">{text.visibilityHint}</p>
      <SettingsCard>
        {sources.length > 1 && (
          <SettingRow
            label={text.source}
            labelId="category-source-label"
            control={
              <Dropdown
                id="category-source"
                labelledBy="category-source-label"
                items={sourceItems}
                value={effectiveSourceId ?? undefined}
                onSelect={(id) => setSelectedSourceId(id)}
                placeholder={text.sourcePlaceholder}
                className="w-[280px] max-w-full"
              />
            }
          />
        )}
        <SettingRow
          label={text.type}
          labelId="category-type-label"
          control={
            <PillChoice<ContentType>
              labelledBy="category-type-label"
              options={TYPE_TABS}
              value={selectedType}
              onChange={setSelectedType}
            />
          }
        />

        <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
          <input
            id="category-filter"
            type="search"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={text.filterPlaceholder}
            aria-label={text.filterLabel}
            className={INPUT_CLASS}
          />

          <div className="max-h-[420px] overflow-y-auto rounded-2xl bg-ground">
            {visibleList.length === 0 ? (
              <p className="px-4 py-8 text-center text-[15px] text-surface-400">
                {scopedCategories.length > 0 ? text.noMatch : text.noCategories}
              </p>
            ) : (
              <ul className="flex flex-col p-1.5">
                {visibleList.map((category) => {
                  const isHidden = hiddenCategoryIds.has(category.id)
                  return (
                    <li key={category.id}>
                      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[14px] px-3 py-1.5 transition-colors hover:bg-raised">
                        <span
                          className={`min-w-0 flex-1 truncate text-[15px] ${isHidden ? 'text-surface-500 line-through' : 'text-white'}`}
                          title={category.name}
                        >
                          {category.name}
                        </span>
                        {category.isAdult && (
                          <span className="shrink-0 rounded-full bg-raised px-2.5 py-0.5 text-xs font-bold text-surface-300">
                            {text.adultBadge}
                          </span>
                        )}
                        <span className="w-14 shrink-0 text-right text-xs font-medium text-surface-500">
                          {isHidden ? text.hidden : text.visible}
                        </span>
                        <Switch checked={!isHidden} onChange={() => toggleCategoryHidden(category.id)} />
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={ACTION.secondary}
              disabled={hiddenCountForSource === 0}
              onClick={() => effectiveSourceId && showAllCategories(effectiveSourceId)}
            >
              {text.showAllHidden}
            </button>
            <span className="text-sm text-surface-400">{text.hiddenCount(hiddenCountForSource)}</span>
          </div>
        </div>
      </SettingsCard>
    </SettingsGroup>
  )
}
