import { useState } from 'react'
import { useStore } from '@/store'
import { AddSource } from '@/components/auth/AddSource'
import { SourceManager } from '@/components/auth/SourceManager'
import { TrustedCertificates } from '@/components/security/TrustedCertificates'
import { strings } from '@/strings'
import { SettingRow, SettingsCard, SettingsGroup, Switch } from './controls'

const text = strings.settings.sources

/**
 * Experimental source kinds, off by default. In this tab rather than beside
 * the corner player (Oynatma), so a new user who wants an add-on finds it
 * under the add step they were sent to.
 */
function ExperimentalSources() {
  const addonSourcesEnabled = useStore((s) => s.settings.addonSourcesEnabled)
  const updateSettings = useStore((s) => s.updateSettings)
  return (
    <SettingsGroup title={text.experimentalGroup}>
      <SettingsCard>
        <SettingRow
          label={text.addonSources}
          htmlFor="addon-sources-enabled"
          help={text.addonSourcesHint}
          helpId="addon-sources-enabled-help"
          control={
            <Switch
              id="addon-sources-enabled"
              checked={addonSourcesEnabled}
              onChange={(checked) => updateSettings({ addonSourcesEnabled: checked })}
              describedBy="addon-sources-enabled-help"
            />
          }
        />
      </SettingsCard>
    </SettingsGroup>
  )
}

/**
 * The sources the user has (with the one in use filled), the servers they
 * trusted, and the guided step that adds one. With no source yet the step
 * is the whole tab: it is where a new user starts.
 */
export function SourcesSettings() {
  const hasSources = useStore((s) => s.sources.length > 0)
  // While a source's sign-in is being entered again, its form holds the
  // screen's one primary action and the add step's button steps back.
  const [editing, setEditing] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <SourceManager onEditingChange={setEditing} />
      <TrustedCertificates />
      <AddSource first={!hasSources} subdued={editing} />
      <ExperimentalSources />
    </div>
  )
}
