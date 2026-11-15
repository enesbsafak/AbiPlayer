import { useId, useReducer } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Upload } from 'lucide-react'
import { ACTION, FieldError, PillChoice, TextField } from '@/components/settings/controls'
import { useStore } from '@/store'
import { pickAndReadFile } from '@/services/platform'
import { secureCredentialService } from '@/services/secure-credentials'
import { ingestM3uText, ingestM3uUrl } from '@/catalog/worker-ingest'
import { discardSourceCatalog } from '@/catalog/cache-lifecycle'
import type { PlaylistSource } from '@/types/playlist'
import { strings } from '@/strings'
import { CredentialReassurance } from './LoginForm'
import { FieldProblem, placeError, type SourceField } from './field-errors'

const { fields, fieldHelp, validation, m3u: text } = strings.sources

/**
 * Loads the playlist of a source that is not added yet through the catalog
 * worker (downloaded or parsed there, cached at once), then adds the source
 * with `add`. What was loaded is dropped again when adding fails.
 */
export async function importPlaylistSource(
  source: PlaylistSource,
  load: () => Promise<unknown>,
  add: () => Promise<void> | void
): Promise<void> {
  try {
    await load()
    await add()
  } catch (error) {
    discardSourceCatalog(source.id)
    throw error
  }
}

type Mode = 'url' | 'file'

interface FormState {
  mode: Mode
  url: string
  name: string
  loading: boolean
  /** Where the last failure is shown: the address, the file button, or the action. */
  error: { field: SourceField | null; message: string } | null
}

type FormAction =
  | { type: 'setMode'; mode: Mode }
  | { type: 'setUrl'; value: string }
  | { type: 'setName'; value: string }
  | { type: 'importStart' }
  | { type: 'importError'; field: SourceField | null; message: string }
  | { type: 'importDone' }
  | { type: 'clearForm' }

const initialFormState: FormState = { mode: 'url', url: '', name: '', loading: false, error: null }

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'setMode':
      return { ...state, mode: action.mode, error: null }
    case 'setUrl':
      // Editing the address clears what was said about it.
      return { ...state, url: action.value, error: state.error?.field === 'url' ? null : state.error }
    case 'setName':
      return { ...state, name: action.value }
    case 'importStart':
      return { ...state, loading: true, error: null }
    case 'importError':
      return { ...state, error: { field: action.field, message: action.message } }
    case 'importDone':
      return { ...state, loading: false }
    case 'clearForm':
      return { ...state, url: '', name: '' }
    default:
      return state
  }
}

/** `subdued`: another form on the screen holds the one primary action. */
export function PlaylistImport({ subdued = false }: { subdued?: boolean } = {}) {
  const navigate = useNavigate()
  const modeLabelId = useId()
  const [{ mode, url, name, loading, error }, dispatch] = useReducer(formReducer, initialFormState)

  const addSource = useStore((s) => s.addSource)
  const setActiveSource = useStore((s) => s.setActiveSource)

  const fail = (err: unknown, address: SourceField) => {
    const placed = placeError(err, text.importFailed, { address })
    dispatch({ type: 'importError', field: placed.field, message: placed.message })
  }

  const handleUrlImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) {
      dispatch({ type: 'importError', field: 'url', message: validation.emptyPlaylistUrl })
      return
    }
    dispatch({ type: 'importStart' })

    try {
      // Add http:// if no protocol specified (consistent with Xtream login)
      let normalizedUrl = url.trim()
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = `http://${normalizedUrl}`
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(normalizedUrl)
      } catch {
        throw new FieldProblem('url', validation.invalidPlaylistUrl)
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new FieldProblem('url', validation.httpOnlyPlaylist)
      }
      normalizedUrl = parsedUrl.toString()

      // Check for duplicate M3U URL source
      const existing = useStore.getState().sources.find(
        (s) => s.type === 'm3u_url' && s.url === normalizedUrl
      )
      if (existing) {
        throw new FieldProblem('url', validation.duplicatePlaylistUrl(existing.name))
      }

      const source: PlaylistSource = {
        id: `m3u_${Date.now()}`,
        name: name.trim() || parsedUrl.hostname,
        type: 'm3u_url',
        url: normalizedUrl,
        addedAt: Date.now()
      }

      await importPlaylistSource(
        source,
        () => ingestM3uUrl(source.id, normalizedUrl),
        async () => {
          // The URL usually holds the account password: it goes to the secure
          // store, and the source is only added once it is stored there.
          await secureCredentialService.setM3uUrl(source.id, normalizedUrl)
          addSource(source)
        }
      )
      setActiveSource(source.id)
      dispatch({ type: 'clearForm' })
      void navigate('/')
    } catch (err) {
      fail(err, 'url')
    } finally {
      dispatch({ type: 'importDone' })
    }
  }

  const handleFileImport = async () => {
    dispatch({ type: 'importStart' })

    try {
      const result = await pickAndReadFile([
        { name: text.fileFilter, extensions: ['m3u', 'm3u8', 'txt'] }
      ])
      if (!result) { dispatch({ type: 'importDone' }); return }

      // Check for duplicate M3U file source
      const existingFile = useStore.getState().sources.find(
        (s) => s.type === 'm3u_file' && s.filePath === result.path
      )
      if (existingFile) {
        throw new FieldProblem('file', validation.duplicateFile(existingFile.name))
      }

      const fileName = result.path.split(/[\\/]/).pop() || text.localListName

      const source: PlaylistSource = {
        id: `m3u_file_${Date.now()}`,
        name: name.trim() || fileName,
        type: 'm3u_file',
        filePath: result.path,
        addedAt: Date.now()
      }

      // Parsed in the worker and cached now, not only at the next start.
      await importPlaylistSource(
        source,
        () => ingestM3uText(source.id, result.content, result.path),
        () => addSource(source)
      )
      setActiveSource(source.id)
      dispatch({ type: 'clearForm' })
      void navigate('/')
    } catch (err) {
      fail(err, 'file')
    } finally {
      dispatch({ type: 'importDone' })
    }
  }

  const nameField = (
    <TextField
      id="m3u-name"
      label={fields.displayName}
      help={fieldHelp.playlistName}
      placeholder={text.namePlaceholder}
      value={name}
      onChange={(e) => dispatch({ type: 'setName', value: e.target.value })}
    />
  )
  const formError = error && error.field === null ? <FieldError>{error.message}</FieldError> : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p id={modeLabelId} className="text-[15px] font-bold text-white">
          {text.modeLabel}
        </p>
        <PillChoice<Mode>
          labelledBy={modeLabelId}
          options={[
            { id: 'url', label: text.modeUrl },
            { id: 'file', label: text.modeFile }
          ]}
          value={mode}
          onChange={(next) => dispatch({ type: 'setMode', mode: next })}
          className="self-start"
        />
      </div>

      {mode === 'url' ? (
        <form noValidate onSubmit={(event) => void handleUrlImport(event)} aria-label={text.title} className="flex flex-col gap-5">
          <TextField
            id="m3u-url"
            label={fields.playlistUrl}
            help={fieldHelp.playlistUrl}
            error={error?.field === 'url' ? error.message : null}
            placeholder={text.urlPlaceholder}
            value={url}
            onChange={(e) => dispatch({ type: 'setUrl', value: e.target.value })}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            required
          />
          {nameField}
          {formError}
          <CredentialReassurance>{strings.sources.add.reassurance}</CredentialReassurance>
          <button type="submit" disabled={loading} className={`${subdued ? ACTION.secondary : ACTION.primary} self-start`}>
            {loading ? (
              <>
                <Loader2 size={20} className="animate-spin" aria-hidden="true" /> {text.importing}
              </>
            ) : (
              text.import
            )}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-5">
          {nameField}
          {formError}
          <CredentialReassurance>{strings.sources.add.fileReassurance}</CredentialReassurance>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void handleFileImport()}
              disabled={loading}
              aria-describedby="m3u-file-help"
              className={`${subdued ? ACTION.secondary : ACTION.primary} self-start`}
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" aria-hidden="true" /> {text.reading}
                </>
              ) : (
                <>
                  <Upload size={20} aria-hidden="true" /> {text.pickFile}
                </>
              )}
            </button>
            {error?.field === 'file' && <FieldError>{error.message}</FieldError>}
            <p id="m3u-file-help" className="px-1 text-sm text-surface-400">
              {fieldHelp.file}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
