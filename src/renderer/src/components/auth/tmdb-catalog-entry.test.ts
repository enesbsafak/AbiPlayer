import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import { catalog } from '@/catalog/catalog-store'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { TMDB_CATALOG_SOURCE_ID, tmdbCatalogSourceFor } from '@/addons/builtin'
import { tmdbCatalogSummary, TmdbRequestError } from '@/addons/tmdb'
import { keepsSecretInStore, needsStoredSecret } from '@/store/auth-slice'
import { connectSource, SourceConnectError } from '@/hooks/useAutoConnect'
import { secureCredentialService } from '@/services/secure-credentials'
import { saveTmdbApiKey } from '@/components/settings/tmdb-api-key'
import { SourcesSettings } from '@/components/settings/SourcesSettings'
import { errors } from '@/strings/errors'
import { strings } from '@/strings'
import { addTmdbCatalog, tmdbCatalogEntryState } from './tmdb-catalog-entry'
import { SourceManager } from './SourceManager'

const KEY = '0123456789abcdef0123456789abcdef'
const SUMMARY = tmdbCatalogSummary({ movie: [{ id: 18, name: 'Dram' }], series: [] })
const text = strings.sources.tmdbCatalog

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

function setKey(key: string) {
  useStore.setState({ settings: { ...DEFAULT_SETTINGS, addonSourcesEnabled: true, tmdbApiKey: key } })
}

beforeEach(() => {
  catalog.reset()
  useStore.setState({
    sources: [],
    activeSourceId: null,
    addonSessions: {},
    sourceErrors: {},
    credentialsHydrated: true,
    secretStoreError: null
  })
  setKey(KEY)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  catalog.reset()
  useStore.setState({ sources: [], activeSourceId: null, addonSessions: {}, sourceErrors: {}, settings: DEFAULT_SETTINGS })
})

describe('the TMDB catalogue’s add action', () => {
  it('needs a key, then can be added once', () => {
    expect(tmdbCatalogEntryState([], '')).toBe('needs-key')
    expect(tmdbCatalogEntryState([], KEY)).toBe('ready')
    expect(tmdbCatalogEntryState([tmdbCatalogSourceFor(SUMMARY, 1)], KEY)).toBe('added')
  })

  it('checks the key with TMDB, adds the source with its catalogues and makes it the one in use when nothing is', async () => {
    const fetchSummary = vi.fn(async () => SUMMARY)
    const result = await addTmdbCatalog({ fetchSummary, now: 5 })
    expect(fetchSummary).toHaveBeenCalledWith(KEY)
    expect(result).toMatchObject({ ok: true, activated: true })
    const state = useStore.getState()
    expect(state.sources).toEqual([
      { id: TMDB_CATALOG_SOURCE_ID, name: text.name, type: 'addon', builtin: 'tmdb', addon: SUMMARY, addedAt: 5 }
    ])
    expect(state.activeSourceId).toBe(TMDB_CATALOG_SOURCE_ID)
    expect(state.addonSessions[TMDB_CATALOG_SOURCE_ID]).toEqual({ manifestFresh: true })
    expect(catalog.getCategories(TMDB_CATALOG_SOURCE_ID, 'vod').map((category) => category.name)).toContain('Dram')
  })

  it('does not take over from a source in use', async () => {
    useStore.setState({ sources: [{ id: 'xt', name: 'Panel', type: 'xtream', addedAt: 1 }], activeSourceId: 'xt' })
    const result = await addTmdbCatalog({ fetchSummary: async () => SUMMARY })
    expect(result).toMatchObject({ ok: true, activated: false })
    expect(useStore.getState().activeSourceId).toBe('xt')
  })

  it('says why it was not added: no key, or the key TMDB refused, never the key itself', async () => {
    setKey('')
    expect(await addTmdbCatalog({ fetchSummary: async () => SUMMARY })).toEqual({ ok: false, message: errors.tmdb.noKey })
    setKey(KEY)
    const refused = await addTmdbCatalog({
      fetchSummary: async () => {
        throw new TmdbRequestError('auth', errors.tmdb.keyRefused, { status: 401 })
      }
    })
    expect(refused).toEqual({ ok: false, message: errors.tmdb.keyRefused })
    expect(useStore.getState().sources).toEqual([])
  })

  it('is offered in Ayarlar → Kaynaklar while add-on sources are on, and leads to the key without one', async () => {
    setKey('')
    render(createElement(MemoryRouter, null, createElement(SourcesSettings)))
    expect(screen.getByText(text.name)).toBeTruthy()
    expect(screen.getByRole('button', { name: text.enterKey })).toBeTruthy()
    expect(screen.queryByRole('button', { name: text.add })).toBeNull()
    expect(screen.getByText(new RegExp(text.needsKey.slice(0, 20)))).toBeTruthy()
    // TMDB's credit beside it.
    expect(screen.getAllByAltText(text.logoAlt).length).toBeGreaterThan(0)

    setKey(KEY)
    await waitFor(() => expect(screen.getByRole('button', { name: text.add })).toBeTruthy())
  })

  it('is not offered while add-on sources are off', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, addonSourcesEnabled: false, tmdbApiKey: KEY } })
    render(createElement(MemoryRouter, null, createElement(SourcesSettings)))
    expect(screen.queryByText(text.name)).toBeNull()
  })
})

describe('the TMDB catalogue in the source list', () => {
  beforeEach(() => {
    useStore.setState({
      sources: [tmdbCatalogSourceFor(SUMMARY, 1)],
      activeSourceId: TMDB_CATALOG_SOURCE_ID,
      addonSessions: { [TMDB_CATALOG_SOURCE_ID]: { manifestFresh: true } }
    })
  })

  it('shows its kind, what it provides and TMDB’s credit; no address, nothing to re-enter', () => {
    render(createElement(MemoryRouter, null, createElement(SourceManager)))
    const row = screen.getByText(text.name).closest('li')!
    expect(row.textContent).toContain(`${text.typeLabel} · ${strings.sources.manager.connected}`)
    expect(row.textContent).toContain(text.attribution)
    expect(row.querySelector('img')?.getAttribute('alt')).toBe(text.logoAlt)
    expect(screen.queryByRole('button', { name: strings.sources.manager.enterAddress })).toBeNull()
    expect(screen.getByRole('button', { name: text.refresh(text.name) })).toBeTruthy()
    expect(screen.getByRole('button', { name: strings.sources.manager.remove(text.name) })).toBeTruthy()
  })

  it('says a key is needed, with the way to it, when there is none', () => {
    setKey('')
    render(createElement(MemoryRouter, null, createElement(SourceManager)))
    expect(screen.getByText(errors.tmdb.noKey)).toBeTruthy()
    expect(screen.getByRole('button', { name: text.enterKey })).toBeTruthy()
    expect(screen.queryByRole('button', { name: text.refresh(text.name) })).toBeNull()
  })

  it('is removed like any source, without touching the secure store', async () => {
    const remove = vi.spyOn(secureCredentialService, 'delete').mockResolvedValue()
    render(createElement(MemoryRouter, null, createElement(SourceManager)))
    fireEvent.click(screen.getByRole('button', { name: strings.sources.manager.remove(text.name) }))
    fireEvent.click(await screen.findByRole('button', { name: strings.common.delete }))
    await waitFor(() => expect(useStore.getState().sources).toEqual([]))
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('the TMDB catalogue as a stored source', () => {
  it('keeps nothing in the secure store and needs no secret from it', () => {
    const source = tmdbCatalogSourceFor(SUMMARY, 1)
    expect(keepsSecretInStore(source)).toBe(false)
    expect(needsStoredSecret(source)).toBe(false)
  })

  it('connects with the saved key, and stops for want of one', async () => {
    const source = tmdbCatalogSourceFor(SUMMARY, 1)
    const setAddonSession = vi.fn()
    const missing = await connectSource(source, { setXtreamAuth: vi.fn(), setAddonSession, tmdbApiKey: null }).catch(
      (caught: unknown) => caught
    )
    expect(missing).toBeInstanceOf(SourceConnectError)
    expect(missing).toMatchObject({ kind: 'missing-secret', message: errors.tmdb.noKey })
    expect(setAddonSession).not.toHaveBeenCalled()

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ genres: [{ id: 18, name: 'Dram' }] }))) as unknown as typeof fetch
    await connectSource(source, { setXtreamAuth: vi.fn(), setAddonSession, tmdbApiKey: KEY, tmdb: { fetchImpl }, updateAddonSummary: vi.fn() })
    expect(setAddonSession).toHaveBeenCalledWith(source.id, { manifestFresh: true })
  })

  it('connects again once a key is saved', async () => {
    useStore.setState({
      sources: [tmdbCatalogSourceFor(SUMMARY, 1)],
      sourceErrors: { [TMDB_CATALOG_SOURCE_ID]: { kind: 'missing-secret', message: errors.tmdb.noKey, retryAt: null } }
    })
    const before = useStore.getState().connectRetryToken
    await saveTmdbApiKey(KEY, async () => undefined)
    expect(useStore.getState().connectRetryToken).toBe(before + 1)
  })
})
