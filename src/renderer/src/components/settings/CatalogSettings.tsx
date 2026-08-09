import { useStore } from '@/store'
import { Dropdown } from '@/components/ui/Dropdown'
import { CategoryVisibility } from './CategoryVisibility'

export function CatalogSettings() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p id="channel-view-mode-label" className="mb-2 text-sm text-surface-400">
          Kanal Görünüm Modu
        </p>
        <Dropdown
          id="channel-view-mode"
          labelledBy="channel-view-mode-label"
          items={[
            { id: 'grid', label: 'Izgara Görünümü' },
            { id: 'list', label: 'Liste Görünümü' }
          ]}
          value={settings.channelViewMode}
          onSelect={(id) => updateSettings({ channelViewMode: id as 'grid' | 'list' })}
          placeholder="Kanal görünüm modu"
        />
      </div>

      <CategoryVisibility />
    </div>
  )
}
