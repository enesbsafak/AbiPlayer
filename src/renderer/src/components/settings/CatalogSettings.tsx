import { useStore } from '@/store'
import { CategoryVisibility } from './CategoryVisibility'

export function AdultContentSetting() {
  const showAdultContent = useStore((s) => s.settings.showAdultContent)
  const updateSettings = useStore((s) => s.updateSettings)

  return (
    <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={showAdultContent}
          onChange={(e) => updateSettings({ showAdultContent: e.target.checked })}
          className="rounded border-surface-700 bg-surface-900 text-accent focus:ring-accent"
        />
        <span className="text-sm text-surface-300">Yetişkin içeriği göster</span>
      </label>
      <p className="mt-1 text-xs text-surface-500">
        Kapalıyken yetişkin içerik olarak tanınan kanallar, filmler, diziler ve kategoriler
        listelerde, aramada ve ana sayfada görünmez. Açıkken listelerin sonunda gösterilir.
      </p>
    </div>
  )
}

export function CatalogSettings() {
  return (
    <div className="flex flex-col gap-6">
      <AdultContentSetting />
      <CategoryVisibility />
    </div>
  )
}
