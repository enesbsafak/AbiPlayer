import { useReducer } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Lock } from 'lucide-react'
import { ACTION, FieldError, TextField } from '@/components/settings/controls'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import { secureCredentialService } from '@/services/secure-credentials'
import type { PlaylistSource } from '@/types/playlist'
import { strings } from '@/strings'
import { FieldProblem, placeError } from './field-errors'

const { fields, fieldHelp, validation, xtream: text } = strings.sources

type Field = 'url' | 'username' | 'password'
type FieldErrors = Partial<Record<Field, string>>

interface LoginState {
  url: string
  username: string
  password: string
  name: string
  loading: boolean
  /** A failure that concerns no single field. */
  error: string
  fieldErrors: FieldErrors
}

type LoginAction =
  | { type: 'setField'; field: Field | 'name'; value: string }
  | { type: 'invalid'; fieldErrors: FieldErrors }
  | { type: 'submitStart' }
  | { type: 'submitError'; field: Field | null; message: string }
  | { type: 'submitDone' }
  | { type: 'clearForm' }

const initialLoginState: LoginState = {
  url: '',
  username: '',
  password: '',
  name: '',
  loading: false,
  error: '',
  fieldErrors: {}
}

function loginReducer(state: LoginState, action: LoginAction): LoginState {
  switch (action.type) {
    case 'setField': {
      // Editing a field clears what was said about it.
      if (action.field === 'name' || !state.fieldErrors[action.field]) return { ...state, [action.field]: action.value }
      const fieldErrors = { ...state.fieldErrors }
      delete fieldErrors[action.field]
      return { ...state, [action.field]: action.value, fieldErrors }
    }
    case 'invalid':
      return { ...state, error: '', fieldErrors: action.fieldErrors }
    case 'submitStart':
      return { ...state, loading: true, error: '', fieldErrors: {} }
    case 'submitError':
      return action.field ? { ...state, fieldErrors: { [action.field]: action.message } } : { ...state, error: action.message }
    case 'submitDone':
      return { ...state, loading: false }
    case 'clearForm':
      return { ...state, url: '', username: '', password: '', name: '' }
    default:
      return state
  }
}

/** The line above an add-source action: where what is typed is kept. */
export function CredentialReassurance({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-3 rounded-card bg-ground px-4 py-3 text-sm text-surface-300">
      <Lock size={18} className="mt-px shrink-0 text-mint" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/** `subdued`: another form on the screen holds the one primary action. */
export function LoginForm({ subdued = false }: { subdued?: boolean } = {}) {
  const navigate = useNavigate()
  const [{ url, username, password, name, loading, error, fieldErrors }, dispatch] = useReducer(loginReducer, initialLoginState)

  const addSource = useStore((s) => s.addSource)
  const setActiveSource = useStore((s) => s.setActiveSource)
  const setXtreamAuth = useStore((s) => s.setXtreamAuth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Pasted credentials often carry a trailing space or newline, which the
    // server then rejects as a wrong password.
    const trimmedUsername = username.trim()
    const trimmedPassword = password.trim()
    const trimmedName = name.trim()

    // Every empty field is named at once, beside itself.
    const missing: FieldErrors = {}
    if (!url.trim()) missing.url = validation.emptyServerUrl
    if (!trimmedUsername) missing.username = validation.emptyUsername
    if (!trimmedPassword) missing.password = validation.emptyPassword
    if (Object.keys(missing).length > 0) {
      dispatch({ type: 'invalid', fieldErrors: missing })
      return
    }

    dispatch({ type: 'submitStart' })

    try {
      // Add http:// if no protocol specified (most IPTV servers use HTTP)
      let normalizedUrl = url.trim().replace(/\/+$/, '')
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = `http://${normalizedUrl}`
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(normalizedUrl)
      } catch {
        throw new FieldProblem('url', validation.invalidServerUrl)
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new FieldProblem('url', validation.httpOnlyServer)
      }
      normalizedUrl = parsedUrl.toString().replace(/\/+$/, '')

      // Check for duplicate Xtream source (same URL + username)
      const existing = useStore.getState().sources.find(
        (s) => s.type === 'xtream' && s.url === normalizedUrl && s.username === trimmedUsername
      )
      if (existing) {
        throw new FieldProblem('url', validation.duplicateXtream(existing.name))
      }

      const creds = { url: normalizedUrl, username: trimmedUsername, password: trimmedPassword }
      const auth = await xtreamApi.authenticate(creds)

      if (auth.user_info.auth !== 1) {
        throw new FieldProblem('password', validation.credentialsRefused)
      }

      const hostname = parsedUrl.host

      const source: PlaylistSource = {
        id: `xtream_${Date.now()}`,
        name: trimmedName || `${trimmedUsername}@${hostname}`,
        type: 'xtream',
        url: creds.url,
        username: trimmedUsername,
        password: trimmedPassword,
        addedAt: Date.now()
      }

      await secureCredentialService.set(source.id, creds)
      // Set auth BEFORE addSource to prevent useAutoConnect from triggering a duplicate auth request
      setXtreamAuth(source.id, auth)
      addSource(source)
      setActiveSource(source.id)

      // Clear form
      dispatch({ type: 'clearForm' })

      // Navigate to home to see channels
      void navigate('/')
    } catch (err) {
      const placed = placeError(err, text.connectFailed, { address: 'url', password: true })
      dispatch({ type: 'submitError', field: placed.field === 'file' ? null : placed.field, message: placed.message })
    } finally {
      dispatch({ type: 'submitDone' })
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} aria-label={text.title} className="flex flex-col gap-5">
      <TextField
        id="xtream-url"
        label={fields.serverUrl}
        help={fieldHelp.serverUrl}
        error={fieldErrors.url}
        placeholder={text.urlPlaceholder}
        value={url}
        onChange={(e) => dispatch({ type: 'setField', field: 'url', value: e.target.value })}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        required
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id="xtream-user"
          label={fields.username}
          help={fieldHelp.username}
          error={fieldErrors.username}
          placeholder={text.usernamePlaceholder}
          value={username}
          onChange={(e) => dispatch({ type: 'setField', field: 'username', value: e.target.value })}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <TextField
          id="xtream-pass"
          label={fields.password}
          help={fieldHelp.password}
          error={fieldErrors.password}
          type="password"
          placeholder={text.passwordPlaceholder}
          value={password}
          onChange={(e) => dispatch({ type: 'setField', field: 'password', value: e.target.value })}
          autoComplete="off"
          required
        />
      </div>
      <TextField
        id="xtream-name"
        label={fields.displayName}
        help={fieldHelp.xtreamName}
        placeholder={text.namePlaceholder}
        value={name}
        onChange={(e) => dispatch({ type: 'setField', field: 'name', value: e.target.value })}
      />

      {error && <FieldError>{error}</FieldError>}

      <CredentialReassurance>{strings.sources.add.reassurance}</CredentialReassurance>

      <button type="submit" disabled={loading} className={`${subdued ? ACTION.secondary : ACTION.primary} self-start`}>
        {loading ? (
          <>
            <Loader2 size={20} className="animate-spin" aria-hidden="true" /> {text.connecting}
          </>
        ) : (
          text.connect
        )}
      </button>
    </form>
  )
}
