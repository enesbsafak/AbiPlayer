import { useStore } from '@/store'
import { strings } from '@/strings'
import { CategoryVisibility } from './CategoryVisibility'

const text = strings.settings.catalog

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
        <span className="text-sm text-surface-300">{text.adultContent}</span>
      </label>
      <p className="mt-1 text-xs text-surface-500">
        {text.adultContentHint}
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
