import { useReducer } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ACTION, FieldError, TextField } from '@/components/settings/controls'
import { useStore } from '@/store'
import { secureCredentialService } from '@/services/secure-credentials'
import { toUserMessage } from '@/services/user-error'
import { commitAddonCategories } from '@/addons/catalog'
import { strings } from '@/strings'
import { CredentialReassurance } from './LoginForm'
import {
  addonOfferLines,
  addonOfferNotes,
  addonSourceFor,
  checkNewAddon,
  findInstalledAddon,
  shouldActivateNewAddon,
  type CheckedAddon
} from './addon-entry'
import type { PlacedError } from './field-errors'

const { fields, fieldHelp, validation, addon: text } = strings.sources

/** The id of the address field; the certificate prompt watches it (PendingSourceCapture). */
export const ADDON_URL_FIELD_ID = 'addon-url'

/*
 * Two steps: the address is checked (its manifest fetched) and what was found
 * is shown; only "Eklentiyi ekle" stores it. The address stays in its own
 * field and nowhere else, and the field is emptied once the add-on is saved.
 */

export interface AddonFormState {
  address: string
  phase: 'edit' | 'checking' | 'review' | 'saving'
  found: CheckedAddon | null
  error: PlacedError | null
  /** The name of the add-on just added (not made active), for the status line. */
  added: string | null
}

export type AddonFormAction =
  | { type: 'setAddress'; value: string }
  | { type: 'checkStart' }
  | { type: 'checkFailed'; error: PlacedError }
  | { type: 'checkDone'; found: CheckedAddon }
  | { type: 'back' }
  | { type: 'saveStart' }
  | { type: 'saveFailed'; error: PlacedError }
  | { type: 'saved'; name: string }

export const initialAddonFormState: AddonFormState = { address: '', phase: 'edit', found: null, error: null, added: null }

export function addonFormReducer(state: AddonFormState, action: AddonFormAction): AddonFormState {
  switch (action.type) {
    case 'setAddress':
      // A changed address is not the one that was checked.
      return { ...state, address: action.value, phase: 'edit', found: null, error: null, added: null }
    case 'checkStart':
      return { ...state, phase: 'checking', found: null, error: null, added: null }
    case 'checkFailed':
      return { ...state, phase: 'edit', error: action.error }
    case 'checkDone':
      return { ...state, phase: 'review', found: action.found, error: null }
    case 'back':
      return { ...state, phase: 'edit', found: null, error: null }
    case 'saveStart':
      return state.found ? { ...state, phase: 'saving', error: null } : state
    case 'saveFailed':
      return { ...state, phase: 'review', error: action.error }
    case 'saved':
      return { ...initialAddonFormState, added: action.name }
    default:
      return state
  }
}

function FoundAddon({ found }: { found: CheckedAddon }) {
  const lines = addonOfferLines(found.offer)
  const notes = addonOfferNotes(found.offer, found.summary.adult)
  return (
    <section aria-label={text.foundLabel} className="flex min-w-0 flex-col gap-4 rounded-card bg-ground p-5">
      <div className="min-w-0">
        <p className="font-title truncate text-[22px] leading-[1.15]">{found.summary.name}</p>
        <p className="mt-1 truncate text-sm text-surface-400">
          {[found.summary.version ? text.version(found.summary.version) : null, found.host].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[15px] font-bold text-white">{text.provides}</p>
        <ul className="flex flex-wrap gap-2">
          {lines.map((line) => (
            <li key={line} className="rounded-full bg-raised px-3.5 py-1.5 text-sm font-medium text-white">
              {line}
            </li>
          ))}
        </ul>
      </div>
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {notes.map((note) => (
            <li key={note} className="flex items-start gap-2.5 text-sm text-surface-300">
              <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-surface-500" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The add step's add-on form. `subdued`: another form on the screen holds the
 * one primary action. A new add-on becomes the source in use only when it can
 * be one and nothing is in use yet (the user's first source among them).
 */
export function AddonForm({ subdued = false }: { subdued?: boolean } = {}) {
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(addonFormReducer, initialAddonFormState)
  const { address, phase, found, error, added } = state
  const busy = phase === 'checking' || phase === 'saving'

  const check = async () => {
    dispatch({ type: 'checkStart' })
    const result = await checkNewAddon(address, useStore.getState().sources)
    if (result.ok) dispatch({ type: 'checkDone', found: result.addon })
    else dispatch({ type: 'checkFailed', error: result.error })
  }

  const save = async (checked: CheckedAddon) => {
    dispatch({ type: 'saveStart' })
    const before = useStore.getState()
    // Added from another window meanwhile, or twice by a double submit.
    const installed = findInstalledAddon(before.sources, checked.summary, checked.base)
    if (installed) {
      dispatch({ type: 'saveFailed', error: { field: 'url', message: validation.duplicateAddon(installed.name) } })
      return
    }
    const source = addonSourceFor(checked)
    const activate = shouldActivateNewAddon(source, before)
    try {
      // The address goes to the secure store first; the source is only added
      // once it is stored there.
      await secureCredentialService.setAddonUrl(source.id, checked.base)
    } catch (cause) {
      dispatch({ type: 'saveFailed', error: { field: null, message: toUserMessage(cause, text.addFailed) } })
      return
    }
    const store = useStore.getState()
    // Its manifest was just fetched: recorded as connected before it is
    // added, so the start-up connection does not fetch it again.
    store.setAddonSession(source.id, { manifestFresh: true })
    store.addSource(source)
    commitAddonCategories(source)
    if (activate && canStillActivate(source.id)) store.setActiveSource(source.id)
    dispatch({ type: 'saved', name: source.name })
    if (activate) void navigate('/')
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (phase === 'review' && found) void save(found)
    else void check()
  }

  const urlError = error?.field ? error.message : null
  const formError = error && !error.field ? error.message : null
  const primary = subdued ? ACTION.secondary : ACTION.primary

  return (
    <form noValidate onSubmit={handleSubmit} aria-label={text.title} className="flex flex-col gap-5">
      <TextField
        id={ADDON_URL_FIELD_ID}
        label={fields.addonUrl}
        help={fieldHelp.addonUrl}
        error={urlError}
        placeholder={text.urlPlaceholder}
        value={address}
        onChange={(event) => dispatch({ type: 'setAddress', value: event.target.value })}
        disabled={phase === 'saving'}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        required
      />
      <CredentialReassurance>{strings.sources.add.addonReassurance}</CredentialReassurance>

      {found && (phase === 'review' || phase === 'saving') && <FoundAddon found={found} />}
      {formError && <FieldError>{formError}</FieldError>}
      {added && (
        <p role="status" className="flex items-center gap-2 px-1 text-sm text-surface-300">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-mint" />
          {text.added(added)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={primary}>
          {phase === 'checking' ? (
            <>
              <Loader2 size={20} className="animate-spin" aria-hidden="true" /> {text.checking}
            </>
          ) : phase === 'saving' ? (
            <>
              <Loader2 size={20} className="animate-spin" aria-hidden="true" /> {text.adding}
            </>
          ) : phase === 'review' ? (
            text.add
          ) : (
            text.check
          )}
        </button>
        {(phase === 'review' || phase === 'saving') && (
          <button type="button" disabled={busy} onClick={() => dispatch({ type: 'back' })} className={ACTION.secondary}>
            {strings.common.cancel}
          </button>
        )}
      </div>
    </form>
  )
}

/** Nothing became active while the address was being stored. */
function canStillActivate(sourceId: string): boolean {
  const { activeSourceId, sources } = useStore.getState()
  return !activeSourceId || activeSourceId === sourceId || !sources.some((source) => source.id === activeSourceId)
}
