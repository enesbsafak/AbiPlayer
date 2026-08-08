import { useMemo, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Input } from '@/components/ui/Input'
import { isAdultLabel } from '@/services/adult-content'
import { applyCategoryView } from '@/services/catalog-view'
import { normalizeSearchText } from '@/services/text-normalize'

type ContentType = 'live' | 'vod' | 'series'

const TYPE_TABS: Array<{ id: ContentType; label: string }> = [
  { id: 'live', label: 'Canlı TV' },
  { id: 'vod', label: 'Filmler' },
  { id: 'series', label: 'Diziler' }
]

export function CategoryVisibility() {
  const sources = useStore((s) => s.sources)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const categories = useStore((s) => s.categories)
  const hiddenCategoryIds = useStore((s) => s.hiddenCategoryIds)
  const sortMode = useStore((s) => s.settings.catalogSortMode)
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

  const visibleList = useMemo(() => {
    const scoped = categories.filter(
      (category) => category.type === selectedType && category.sourceId === effectiveSourceId
    )
    const ordered = applyCategoryView(scoped, {
      hiddenCategoryIds,
      sortMode,
      includeHidden: true
    })

    if (!filterQuery.trim()) return ordered
    const q = normalizeSearchText(filterQuery)
    return ordered.filter((category) => normalizeSearchText(category.name).includes(q))
  }, [categories, selectedType, effectiveSourceId, hiddenCategoryIds, sortMode, filterQuery])

  const hiddenCountForSource = useMemo(
    () =>
      categories.filter(
        (category) => category.sourceId === effectiveSourceId && hiddenCategoryIds.has(category.id)
      ).length,
    [categories, effectiveSourceId, hiddenCategoryIds]
  )

  if (sources.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-4">Kategoriler</h2>
        <p className="rounded-lg border border-surface-800 bg-surface-900 px-4 py-3 text-sm text-surface-400">
          Kategori yönetimi için önce bir kaynak ekleyin.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">Kategoriler</h2>
      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p className="text-sm text-surface-400">
          Gizlediğiniz kategoriler listelerden tamamen çıkar; içindeki kanallar da görünmez.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {sources.length > 1 && (
            <div>
              <p id="category-source-label" className="text-sm text-surface-400 mb-2">
                Kaynak
              </p>
              <Dropdown
                id="category-source"
                labelledBy="category-source-label"
                items={sourceItems}
                value={effectiveSourceId ?? undefined}
                onSelect={(id) => setSelectedSourceId(id)}
                placeholder="Kaynak seç"
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
            placeholder="Kategori ara..."
          />
        </div>

        <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-surface-800">
          {visibleList.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-surface-500">
              {categories.some((c) => c.sourceId === effectiveSourceId && c.type === selectedType)
                ? 'Aramayla eşleşen kategori yok.'
                : 'Bu tür için kategori bulunamadı. Kaynak taraması tamamlanmamış olabilir.'}
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
                      {isAdultLabel(category.name) && (
                        <span className="shrink-0 rounded bg-surface-800 px-1.5 py-0.5 text-xs text-surface-400">
                          18+
                        </span>
                      )}
                      {isHidden ? (
                        <EyeOff size={14} className="shrink-0 text-surface-500" aria-label="Gizli" />
                      ) : (
                        <Eye size={14} className="shrink-0 text-surface-600" aria-label="Görünür" />
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
            Bu kaynaktaki gizlileri geri getir
          </Button>
          <span className="text-xs text-surface-500">
            {hiddenCountForSource > 0
              ? `${hiddenCountForSource} kategori gizli`
              : 'Gizli kategori yok'}
          </span>
        </div>
      </div>
    </section>
  )
}
