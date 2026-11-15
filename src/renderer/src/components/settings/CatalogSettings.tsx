import { useStore } from '@/store'
import { strings } from '@/strings'
import { CategoryVisibility } from './CategoryVisibility'
import { SettingRow, SettingsCard, SettingsGroup, Switch } from './controls'

const text = strings.settings.catalog

export function AdultContentSetting() {
  const showAdultContent = useStore((s) => s.settings.showAdultContent)
  const updateSettings = useStore((s) => s.updateSettings)

  return (
    <SettingsGroup title={text.contentGroup}>
      <SettingsCard>
        <SettingRow
          label={text.adultContent}
          htmlFor="show-adult-content"
          help={text.adultContentHint}
          helpId="show-adult-content-help"
          control={
            <Switch
              id="show-adult-content"
              checked={showAdultContent}
              onChange={(checked) => updateSettings({ showAdultContent: checked })}
              describedBy="show-adult-content-help"
            />
          }
        />
      </SettingsCard>
    </SettingsGroup>
  )
}

export function CatalogSettings() {
  return (
    <div className="flex flex-col gap-8">
      <AdultContentSetting />
      <CategoryVisibility />
    </div>
  )
}
