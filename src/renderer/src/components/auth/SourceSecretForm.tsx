import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ACTION, FieldError, TextField } from '@/components/settings/controls'
import { useStore } from '@/store'
import { toUserMessage } from '@/services/user-error'
import type { PlaylistSource } from '@/types/playlist'
import { strings } from '@/strings'
import { normalizeSecretInput, saveSourceSecret } from './source-secret'

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
 * Enters the secret of an existing source again, in place: the source keeps
 * its id, so favourites, history and hidden categories stay with it.
 */
export function SourceSecretForm({ source, onDone }: { source: PlaylistSource; onDone: () => void }) {
  const isXtream = source.type === 'xtream'
  const [url, setUrl] = useState(source.url ?? '')
  const [username, setUsername] = useState(source.username ?? '')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const input = normalizeSecretInput(source, { url, username, password }, useStore.getState().sources)
    if (!input.ok) {
      setError(input.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveSourceSecret(source.id, input.secret)
      onDone()
    } catch (cause) {
      setError(text.saveFailed(toUserMessage(cause)))
    } finally {
      setSaving(false)
    }
  }

  const errorField = error ? fieldOf(error) : null
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
        label={isXtream ? fields.serverUrl : fields.playlistUrl}
        help={isXtream ? fieldHelp.serverUrl : fieldHelp.playlistUrl}
        error={errorField === 'url' ? error : null}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
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
            error={errorField === 'credentials' ? error : null}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
      )}
      {error && errorField === null && <FieldError>{error}</FieldError>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={ACTION.primary}>
          {saving ? (
            <>
              <Loader2 size={20} className="animate-spin" aria-hidden="true" /> {text.saving}
            </>
          ) : (
            text.save
          )}
        </button>
        <button type="button" onClick={onDone} disabled={saving} className={ACTION.secondary}>
          {strings.common.cancel}
        </button>
      </div>
    </form>
  )
}
