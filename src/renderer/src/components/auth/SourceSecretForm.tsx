import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ACTION, FieldError, TextField } from '@/components/settings/controls'
import { useStore } from '@/store'
import { toUserMessage } from '@/services/user-error'
import type { PlaylistSource } from '@/types/playlist'
import { strings } from '@/strings'
import { checkAddonAddressFor } from './addon-entry'
import { normalizeSecretInput, saveSourceSecret, type SecretInputResult } from './source-secret'

const { fields, fieldHelp, validation, secretForm: text } = strings.sources

type Field = 'url' | 'credentials'

/** Which field a check of `normalizeSecretInput` is about, so it is shown beside it. */
function fieldOf(message: string): Field | null {
  if (message === validation.emptyCredentials) return 'credentials'
  if (
    message === validation.emptyServerUrl ||
    message === validation.emptyPlaylistUrl ||
    message === validation.invalidServerUrl ||
    message === validation.invalidPlaylistUrl ||
    message === validation.httpOnly
  ) {
    return 'url'
  }
  return null
}

/**
 * An add-on's address typed again: its manifest is fetched, so a refused or
 * wrong address is said here rather than at the next connection.
 */
async function addonSecretInput(source: PlaylistSource, url: string): Promise<SecretInputResult & { field?: Field | null }> {
  const result = await checkAddonAddressFor(source, url, useStore.getState().sources)
  if (!result.ok) return { ok: false, error: result.error.message, field: result.error.field ? 'url' : null }
  return { ok: true, secret: { addonUrl: result.addon.base, addon: result.addon.summary } }
}

/**
 * Enters the secret of an existing source again, in place: the source keeps
 * its id, so favourites, history and hidden categories stay with it. An
 * add-on's address is never put back in the field: it starts empty.
 */
export function SourceSecretForm({ source, onDone }: { source: PlaylistSource; onDone: (saved: boolean) => void }) {
  const isXtream = source.type === 'xtream'
  const isAddon = source.type === 'addon'
  const [url, setUrl] = useState(isAddon ? '' : (source.url ?? ''))
  const [username, setUsername] = useState(source.username ?? '')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ message: string; field: Field | null } | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    let input: SecretInputResult & { field?: Field | null }
    if (isAddon) {
      setSaving(true)
      setError(null)
      input = await addonSecretInput(source, url)
    } else {
      input = normalizeSecretInput(source, { url, username, password }, useStore.getState().sources)
    }
    if (!input.ok) {
      setError({ message: input.error, field: input.field !== undefined ? input.field : fieldOf(input.error) })
      setSaving(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveSourceSecret(source.id, input.secret)
      onDone(true)
    } catch (cause) {
      setError({ message: text.saveFailed(toUserMessage(cause)), field: null })
    } finally {
      setSaving(false)
    }
  }

  const errorField = error?.field ?? null
  const idPrefix = `secret-${source.id}`
  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(event)}
      className="mx-2 mb-2 mt-2 flex flex-col gap-4 rounded-[14px] bg-ground p-4"
      aria-label={text.label(source.name)}
    >
      <p className="text-sm text-surface-300">{text.hint}</p>
      <TextField
        id={`${idPrefix}-url`}
        label={isXtream ? fields.serverUrl : isAddon ? fields.addonUrl : fields.playlistUrl}
        help={isXtream ? fieldHelp.serverUrl : isAddon ? fieldHelp.addonUrl : fieldHelp.playlistUrl}
        error={errorField === 'url' ? error?.message : null}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        required
      />
      {isXtream && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id={`${idPrefix}-user`}
            label={fields.username}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            spellCheck={false}
            required
          />
          <TextField
            id={`${idPrefix}-pass`}
            label={fields.password}
            type="password"
            error={errorField === 'credentials' ? error?.message : null}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
      )}
      {error && errorField === null && <FieldError>{error.message}</FieldError>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={ACTION.primary}>
          {saving ? (
            <>
              <Loader2 size={20} className="animate-spin" aria-hidden="true" />{' '}
              {isAddon ? strings.sources.addon.checking : text.saving}
            </>
          ) : (
            text.save
          )}
        </button>
        <button type="button" onClick={() => onDone(false)} disabled={saving} className={ACTION.secondary}>
          {strings.common.cancel}
        </button>
      </div>
    </form>
  )
}
