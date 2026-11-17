import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { AddSource } from '@/components/auth/AddSource'
import { SourceManager } from '@/components/auth/SourceManager'
import { addTmdbCatalog, tmdbCatalogEntryState } from '@/components/auth/tmdb-catalog-entry'
import { TmdbAttribution, useOpenTmdbKeyField } from '@/components/addons/TmdbAttribution'
import { TrustedCertificates } from '@/components/security/TrustedCertificates'
import { strings } from '@/strings'
import { ACTION, FieldError, SettingRow, SettingsCard, SettingsGroup, Switch } from './controls'

const text = strings.settings.sources
const tmdbText = strings.sources.tmdbCatalog

/**
 * The built-in TMDB catalogue's add action: enabled once a TMDB key is
 * saved; without one it says so and leads to the key's field. Once added it
 * is a source like the others, listed (and removed) above.
 */
function TmdbCatalogEntry() {
  const navigate = useNavigate()
  const state = useStore((s) => tmdbCatalogEntryState(s.sources, s.settings.tmdbApiKey))
  const openKeyField = useOpenTmdbKeyField()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(false)

  const add = async () => {
    if (adding) return
    setAdding(true)
    setError(null)
    const result = await addTmdbCatalog()
    setAdding(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setAdded(true)
    if (result.activated) void navigate('/')
  }

  let control
  if (state === 'added') control = <span className="px-1 text-[15px] font-medium text-surface-400">{tmdbText.alreadyAdded}</span>
  else if (state === 'needs-key') {
    control = (
      <button type="button" className={ACTION.secondary} onClick={openKeyField} aria-describedby="tmdb-catalog-help">
        {tmdbText.enterKey}
      </button>
    )
  } else {
    control = (
      <button type="button" className={ACTION.secondary} onClick={() => void add()} disabled={adding} aria-describedby="tmdb-catalog-help">
        {adding ? (
          <>
            <Loader2 size={18} className="animate-spin" aria-hidden="true" /> {tmdbText.adding}
          </>
        ) : (
          tmdbText.add
        )}
      </button>
    )
  }

  return (
    <SettingRow
      label={tmdbText.name}
      help={state === 'needs-key' ? `${tmdbText.hint} ${tmdbText.needsKey}` : tmdbText.hint}
      helpId="tmdb-catalog-help"
      control={control}
    >
      <TmdbAttribution />
      {error && <FieldError>{error}</FieldError>}
      {added && state === 'added' && (
        <p role="status" className="flex items-center gap-2 px-1 text-sm text-surface-300">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-mint" />
          {strings.sources.addon.added(tmdbText.name)}
        </p>
      )}
    </SettingRow>
  )
}

/**
 * Experimental source kinds, off by default. In this tab rather than beside
 * the corner player (Oynatma), so a new user who wants an add-on finds it
 * under the add step they were sent to. With the switch on, the built-in
 * TMDB catalogue can be added here too.
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
        {addonSourcesEnabled && <TmdbCatalogEntry />}
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
