import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPartialize, mergePersistedState, useStore, type AppStore } from '@/store'
import { keepsSecretInStore, persistableSource } from '@/store/auth-slice'
import { redactStoredCopy } from '@/store/stored-copy-redaction'
import { normalizeSettings } from '@/store/settings-slice'
import { catalog } from '@/catalog/catalog-store'
import { hasDiskCache } from '@/catalog/cache-lifecycle'
import { sourceIdentity } from '@/catalog/worker-ingest'
import { epgUrlFor } from '@/hooks/useEPG'
import {
  connectSource,
  MISSING_ADDON_URL_MESSAGE,
  needsConnection,
  planSecretMigration,
  SourceConnectError
} from '@/hooks/useAutoConnect'
import { splitSourceSecrets } from '@/services/secure-credentials'
import { XtreamRequestError } from '@/services/xtream-errors'
import {
  planProgressUpdate,
  sanitizeProgressEntries,
  selectContinueWatching,
  type WatchProgressEntry
} from '@/services/watch-progress'
import { DEFAULT_SETTINGS } from '@/types/settings'
import type { PlaylistSource } from '@/types/playlist'
import { addonTarget } from '../../../shared/playback'
import { defined } from '../../../shared/checked'
import { summarizeManifest } from './manifest'
import { forgetAddonStreams, registerAddonStreamUrl } from './stream-registry'
import {
  CATALOG_BASE,
  CATALOG_MANIFEST,
  SECRET_SEGMENT,
  STREAM_BASE,
  STREAM_URL,
  catalogSource,
  streamSource
} from './testing/fixtures'

const SECRETS = [CATALOG_BASE, STREAM_BASE, STREAM_URL, SECRET_SEGMENT]

function expectNoSecrets(text: string) {
  for (const secret of SECRETS) expect(text).not.toContain(secret)
}

const film = addonTarget({ sourceId: 'ek', contentType: 'movie', metaId: 'tt0000001' })

function resetStore() {
  useStore.setState({
    sources: [],
    activeSourceId: null,
    xtreamAuth: {},
    addonSessions: {},
    sourceErrors: {},
    legacySecretSourceIds: [],
    watchProgress: []
  })
  useStore.getState().stopPlayback()
}

beforeEach(() => {
  catalog.reset()
  resetStore()
})

afterEach(() => {
  vi.restoreAllMocks()
  forgetAddonStreams()
  catalog.reset()
  resetStore()
})

describe('what is persisted of an add-on', () => {
  it('never writes the base address or a stream URL to storage', () => {
    useStore.setState({ sources: [catalogSource(), streamSource()], activeSourceId: 'ek' })
    const channel = { id: 'ek_vod_populer/tt0000001', name: 'Örnek Film', streamUrl: '', sourceId: 'ek', type: 'vod' as const, addonMetaId: 'tt0000001' }
    useStore.getState().playAddonStream({ target: film, channel, handle: registerAddonStreamUrl(film, STREAM_URL) })
    expect(useStore.getState().currentPlayback?.streamUrl).toBe(STREAM_URL)
    // The recorder saves with the URL being played at hand.
    useStore.getState().saveWatchProgress({ target: film, channel, streamUrl: STREAM_URL }, 600, 6_000)
    expect(useStore.getState().watchProgress).toHaveLength(1)
    expect(planProgressUpdate({ target: film, channel, streamUrl: STREAM_URL }, 600, 6_000).kind).toBe('upsert')

    const persisted = createPartialize()(useStore.getState() as AppStore)
    const text = JSON.stringify(persisted)
    expectNoSecrets(text)
    expect(persisted.sources[0]).toEqual({
      id: 'ek',
      name: 'Örnek Katalog',
      type: 'addon',
      addon: summarizeManifest(CATALOG_MANIFEST),
      addedAt: 1
    })
    expect(persisted.watchProgress[0]).toMatchObject({ key: 'addon:ek:tt0000001', target: film, channel: { streamUrl: '' } })
  })

  it('keeps its address in the secure store, so removing the source wipes it there', () => {
    expect(keepsSecretInStore(catalogSource())).toBe(true)
    expect(keepsSecretInStore({ type: 'm3u_url' })).toBe(true)
    expect(keepsSecretInStore({ type: 'xtream' })).toBe(true)
    expect(keepsSecretInStore({ type: 'm3u_file' })).toBe(false)
  })

  it('drops the address from a source unless its plain copy still waits to move to the secure store', () => {
    expect(persistableSource(catalogSource(), false)).not.toHaveProperty('url')
    expect(persistableSource(catalogSource(), true).url).toBe(CATALOG_BASE)
  })

  it('reads a stored add-on back with its summary checked and its address to be hydrated', () => {
    const current = useStore.getState()
    const merged = mergePersistedState(
      {
        sources: [
          { id: 'ek', name: 'Örnek Katalog', type: 'addon', addon: summarizeManifest(CATALOG_MANIFEST), addedAt: 1 },
          { id: 'bozuk', name: 'Bozuk', type: 'addon', addon: 'çöp', addedAt: 2 }
        ]
      },
      { ...current, credentialsHydrated: true }
    )
    expect(merged.sources[0]?.addon).toEqual(summarizeManifest(CATALOG_MANIFEST))
    expect(merged.sources[1]?.addon).toMatchObject({ name: 'Bozuk', catalogs: [], resources: [] })
    expect(merged.credentialsHydrated).toBe(false)
    expect(merged.legacySecretSourceIds).toEqual([])
  })

  it('treats a stored plain address (hand edited) as a secret to move', () => {
    const merged = mergePersistedState({ sources: [catalogSource()] }, useStore.getState())
    expect(merged.legacySecretSourceIds).toEqual(['ek'])
    const plan = planSecretMigration(merged.sources, merged.legacySecretSourceIds, { xtream: {}, m3uUrls: {}, addonUrls: {} })
    expect(plan.writes).toEqual([{ sourceId: 'ek', secret: { addonUrl: CATALOG_BASE } }])
    const known = planSecretMigration(merged.sources, merged.legacySecretSourceIds, { xtream: {}, m3uUrls: {}, addonUrls: { ek: CATALOG_BASE } })
    expect(known.alreadyStored).toEqual(['ek'])
  })

  it('redacts the address from side copies of the stored state', () => {
    const raw = JSON.stringify({
      state: {
        sources: [catalogSource()],
        // The settings segment is masked in any URL, not only the add-on's own.
        watchProgress: [{ key: 'x', note: `${CATALOG_BASE}/stream/movie/tt1.json` }, { note: `https://yonlendirme.example/${SECRET_SEGMENT}/v.mp4` }]
      },
      version: 4
    })
    const redacted = redactStoredCopy(raw)
    expectNoSecrets(redacted)
    expect(JSON.parse(redacted).state.sources[0]).not.toHaveProperty('url')
    expect(JSON.parse(redacted).state.sources[0].addon.name).toBe('Örnek Katalog')
  })
})

describe('add-on secrets in the store', () => {
  it('splits the secure store’s add-on entries and puts them on the sources', () => {
    const split = splitSourceSecrets({ ek: { kind: 'addon', url: CATALOG_BASE }, mu: { kind: 'm3u_url', url: 'http://p.example/a.m3u' } })
    expect(split).toEqual({ xtream: {}, m3uUrls: { mu: 'http://p.example/a.m3u' }, addonUrls: { ek: CATALOG_BASE } })
    useStore.setState({ sources: [catalogSource({ url: undefined })] })
    useStore.getState().hydrateSourceSecrets(split)
    expect(useStore.getState().sources[0]?.url).toBe(CATALOG_BASE)
  })

  it('never makes a stream-only add-on the active source', () => {
    useStore.setState({ sources: [catalogSource(), streamSource(), { id: 'xt', name: 'Panel', type: 'xtream', addedAt: 3 }], activeSourceId: 'ek' })
    useStore.getState().removeSource('ek')
    expect(useStore.getState().activeSourceId).toBe('xt')
  })

  it('records and forgets a connected add-on', () => {
    useStore.setState({ sources: [catalogSource()], sourceErrors: { ek: { kind: 'other', message: 'x', retryAt: null } } })
    useStore.getState().setAddonSession('ek', { manifestFresh: true })
    expect(useStore.getState().addonSessions).toEqual({ ek: { manifestFresh: true } })
    expect(useStore.getState().sourceErrors).toEqual({})
    useStore.getState().removeSource('ek')
    expect(useStore.getState().addonSessions).toEqual({})
  })
})

describe('connecting an add-on', () => {
  const deps = () => ({
    setXtreamAuth: vi.fn(),
    setAddonSession: vi.fn(),
    updateAddonSummary: vi.fn()
  })

  it('needs its address from the secure store', async () => {
    const error = await connectSource(catalogSource({ url: undefined }), deps()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SourceConnectError)
    expect(error).toMatchObject({ kind: 'missing-secret', message: MISSING_ADDON_URL_MESSAGE })
  })

  it('refreshes the manifest, stores a changed summary and lists the catalogues', async () => {
    const d = deps()
    const fresh = { ...CATALOG_MANIFEST, version: '1.3.0' }
    await connectSource(catalogSource(), { ...d, fetchAddonManifest: async (base) => {
      expect(base).toBe(CATALOG_BASE)
      return defined(summarizeManifest(fresh))
    } })
    expect(d.updateAddonSummary).toHaveBeenCalledWith('ek', summarizeManifest(fresh))
    expect(d.setAddonSession).toHaveBeenCalledWith('ek', { manifestFresh: true })
    expect(catalog.getCategories('ek', 'vod').map((category) => category.name)).toEqual(['Popüler Filmler'])
  })

  it('does not rewrite an unchanged summary', async () => {
    const d = deps()
    await connectSource(catalogSource(), { ...d, fetchAddonManifest: async () => defined(summarizeManifest(CATALOG_MANIFEST)) })
    expect(d.updateAddonSummary).not.toHaveBeenCalled()
  })

  it('connects with the stored summary when the add-on cannot be reached, logging no address', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const d = deps()
    await connectSource(catalogSource(), {
      ...d,
      fetchAddonManifest: async () => Promise.reject(new XtreamRequestError('network', 'Sunucuya ulaşılamadı.', { host: 'addon.example' }))
    })
    expect(d.setAddonSession).toHaveBeenCalledWith('ek', { manifestFresh: false })
    expect(d.updateAddonSummary).not.toHaveBeenCalled()
    expect(catalog.getCategories('ek', 'series').map((category) => category.name)).toEqual(['Yeni Diziler'])
    expectNoSecrets(JSON.stringify(warn.mock.calls))
  })

  it('counts an add-on as connected only once its session is recorded', () => {
    const none = new Set<string>()
    expect(needsConnection(catalogSource(), none, new Set(['ek']))).toBe(true)
    expect(needsConnection(catalogSource(), none, none, new Set(['ek']))).toBe(false)
  })

  it('has no disk cache, no cache identity and no guide', () => {
    expect(hasDiskCache(catalogSource())).toBe(false)
    expect(hasDiskCache({ id: 'mu', name: 'Liste', type: 'm3u_url', addedAt: 1 })).toBe(true)
    expect(sourceIdentity(catalogSource())).toBeNull()
    expect(epgUrlFor(catalogSource())).toBeNull()
  })
})

describe('watch progress of add-on items', () => {
  const entry: WatchProgressEntry = {
    key: 'addon:ek:tt0000001',
    target: film,
    channel: { id: 'c', name: 'Örnek Film', streamUrl: STREAM_URL, sourceId: 'ek', type: 'vod' },
    position: 600,
    duration: 6_000,
    updatedAt: 1
  }

  it('is accepted back from storage, without any URL', () => {
    const [restored] = sanitizeProgressEntries([entry])
    expect(restored).toMatchObject({ key: 'addon:ek:tt0000001', target: film })
    expect(restored?.channel.streamUrl).toBe('')
  })

  it('stays in "continue watching" while its catalogue source exists, credentials or not', () => {
    const shown = selectContinueWatching([entry], { hasCredentials: () => false, hasSource: (id) => id === 'ek', limit: 5 })
    expect(shown.map((item) => item.target)).toEqual([film])
    expect(selectContinueWatching([entry], { hasCredentials: () => true, hasSource: () => false, limit: 5 })).toEqual([])
  })
})

describe('experimental setting', () => {
  it('is off by default and kept only as a boolean', () => {
    expect(DEFAULT_SETTINGS.addonSourcesEnabled).toBe(false)
    expect(normalizeSettings({}).addonSourcesEnabled).toBe(false)
    expect(normalizeSettings({ addonSourcesEnabled: true }).addonSourcesEnabled).toBe(true)
    expect(normalizeSettings({ addonSourcesEnabled: 'evet' }).addonSourcesEnabled).toBe(false)
  })
})

describe('other source kinds are left alone', () => {
  it('keeps persisting Xtream and M3U sources as before', () => {
    const xtream: PlaylistSource = { id: 'xt', name: 'Panel', type: 'xtream', url: 'http://panel.example', username: 'a', password: 'b', addedAt: 1 }
    expect(persistableSource(xtream, false)).toEqual({ id: 'xt', name: 'Panel', type: 'xtream', url: 'http://panel.example', addedAt: 1 })
    const file: PlaylistSource = { id: 'mf', name: 'Dosya', type: 'm3u_file', filePath: 'C:\\a.m3u', addedAt: 1 }
    expect(persistableSource(file, false)).toBe(file)
  })
})
