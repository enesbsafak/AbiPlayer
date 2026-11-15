import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return { ...actual, readPickedFile: vi.fn() }
})

import { createPartialize, useStore, type AppStore } from '@/store'
import { catalog } from '@/catalog/catalog-store'
import { xtreamApi } from '@/services/xtream-api'
import { XtreamRequestError } from '@/services/xtream-errors'
import { readPickedFile } from '@/services/platform'
import { secureCredentialService } from '@/services/secure-credentials'
import { ingestM3uText } from '@/catalog/worker-ingest'
import type { PlaylistSource } from '@/types/playlist'
import type { XtreamAuthResponse } from '@/types/xtream'
import {
  connectSource,
  describeConnectFailure,
  fileReadFailureMessage,
  hydrateSecrets,
  MISSING_M3U_URL_MESSAGE,
  SECRET_STORE_UNREADABLE_MESSAGE,
  SECRETS_UNAVAILABLE_MESSAGE,
  planSecretMigration,
  reconnectDelayMs,
  SECRET_MIGRATION_FAILED_MESSAGE,
  SourceConnectError,
  sourcesWithCatalogKey,
  useAutoConnect
} from './useAutoConnect'

const PLAYLIST = '#EXTM3U\n#EXTINF:-1 group-title="Haber",Kanal 1\nhttp://cdn.test/1.ts\n'
const okAuth = { user_info: { auth: 1 } } as unknown as XtreamAuthResponse
const xtream: PlaylistSource = {
  id: 'xt',
  name: 'Panel',
  type: 'xtream',
  url: 'http://panel.test',
  username: 'ali',
  password: 's3cret',
  addedAt: 1
}
const fileSource: PlaylistSource = { id: 'mf', name: 'Dosya', type: 'm3u_file', filePath: 'C:\\listeler\\a.m3u', addedAt: 1 }
const urlSource: PlaylistSource = {
  id: 'mu',
  name: 'Liste',
  type: 'm3u_url',
  url: 'http://panel.test/get.php?username=ali&password=s3cret',
  addedAt: 1
}

function resetStore() {
  useStore.setState({
    sources: [],
    activeSourceId: null,
    xtreamAuth: {},
    credentialsHydrated: false,
    isLoading: false,
    error: null,
    sourceErrors: {},
    legacySecretSourceIds: [],
    secretMigrationError: null,
    secretStoreError: null,
    tmdbKeyPlainPending: false
  })
}

beforeEach(() => {
  catalog.reset()
  resetStore()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  catalog.reset()
  resetStore()
})

describe('reconnect timing (F1-31)', () => {
  it('backs off and settles at a minute', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(reconnectDelayMs)).toEqual([
      3_000, 6_000, 12_000, 24_000, 48_000, 60_000, 60_000, 60_000
    ])
  })

  it('retries network trouble but not a refused account, and speaks Turkish', () => {
    const network = describeConnectFailure(new TypeError('Failed to fetch'), 2, 1_000)
    expect(network).toEqual({ kind: 'other', message: expect.stringMatching(/Sunucuya ulaşılamadı/), retryAt: 7_000 })

    const refused = describeConnectFailure(new XtreamRequestError('auth', 'Kimlik doğrulama başarısız'), 1, 1_000)
    expect(refused).toMatchObject({ kind: 'auth', retryAt: null })
    expect(describeConnectFailure(new SourceConnectError('file', 'Dosya bulunamadı.'), 1, 0)).toEqual({
      kind: 'file',
      message: 'Dosya bulunamadı.',
      retryAt: null
    })
  })
})

describe('sourcesWithCatalogKey (C2c)', () => {
  it('does not count a cached copy as connected, so the playlist is still fetched at start', () => {
    const status = (fromCache: boolean) => ({ loaded: true, fromCache }) as never
    expect(sourcesWithCatalogKey({ a: { live: status(true) }, b: { live: status(false) } })).toBe('b')
  })
})

describe('connectSource', () => {
  const deps = () => ({ setXtreamAuth: vi.fn() })

  it('reads a local playlist file again on start (F1-27)', async () => {
    const d = deps()
    const readFile = vi.fn().mockResolvedValue({ path: fileSource.filePath, content: PLAYLIST })
    await connectSource(fileSource, { ...d, readFile })
    expect(readFile).toHaveBeenCalledWith('C:\\listeler\\a.m3u')
    // Parsed in the catalog worker and swapped in as complete, fresh lists.
    expect(catalog.getItems('mf', 'live').map((entry) => entry.name)).toEqual(['Kanal 1'])
    expect(catalog.getStatus('mf', 'live')).toMatchObject({ complete: true, fromCache: false })
  })

  it('keeps the cached copy of a file that is gone, and says so', async () => {
    const fetchedAt = Date.UTC(2026, 10, 14, 18, 30)
    const token = catalog.beginGeneration('mf', 'live')
    catalog.commit({
      token,
      mode: 'replace',
      items: [{ id: 'x', name: 'Kayıtlı', streamUrl: 'http://cdn.test/x.ts', sourceId: 'mf', type: 'live', searchName: 'kayitli', isAdult: false }],
      origin: { fromCache: true, fetchedAt }
    })
    const readFile = vi.fn().mockRejectedValue(new Error('Dosya bulunamadı: a.m3u'))
    const error = await connectSource(fileSource, { ...deps(), readFile }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ kind: 'file' })
    expect((error as Error).message).toMatch(/tarihinde okunan kopyası gösteriliyor\.$/)
    expect(catalog.getItems('mf', 'live')).toHaveLength(1)
  })

  it('says so when the file is gone, and asks for it to be picked again', async () => {
    const readFile = vi.fn().mockRejectedValue(
      new Error("Error invoking remote method 'read-picked-file': Error: Dosya bulunamadı: a.m3u")
    )
    const error = await connectSource(fileSource, { ...deps(), readFile }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SourceConnectError)
    expect(error).toMatchObject({ kind: 'file', message: 'Dosya bulunamadı: a.m3u Dosyayı yeniden seçin.' })
  })

  it('rejects an account the panel refuses as an auth failure', async () => {
    const authenticate = vi.fn().mockResolvedValue({ user_info: { auth: 0 } })
    const error = await connectSource(xtream, { ...deps(), authenticate }).catch((caught: unknown) => caught)
    expect(describeConnectFailure(error, 1, 0).kind).toBe('auth')
  })

  it('needs the stored secret, and asks for it to be entered again rather than the source re-added (K3)', async () => {
    const { url: _url, ...withoutUrl } = urlSource
    const error = await connectSource(withoutUrl, deps()).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ kind: 'missing-secret', message: MISSING_M3U_URL_MESSAGE })
    expect((error as Error).message).not.toMatch(/silip/)
    // While the store cannot be read, the secret is not gone: it is read again.
    await expect(connectSource(withoutUrl, { ...deps(), secretsUnavailable: true })).rejects.toMatchObject({
      kind: 'missing-secret',
      message: SECRETS_UNAVAILABLE_MESSAGE
    })
  })

  it('fetches the playlist again when the catalog dropped it for a source that still exists (K1)', async () => {
    useStore.setState({ sources: [urlSource] })
    let calls = 0
    const ingestUrl = vi.fn(async (sourceId: string) => {
      calls += 1
      const pending = ingestM3uText(sourceId, PLAYLIST, 'x.m3u')
      // The first download is overtaken by a refresh of the source.
      if (calls === 1) catalog.replaceSource(sourceId, null)
      return pending
    })
    await connectSource(urlSource, { ...deps(), ingestUrl })
    expect(ingestUrl).toHaveBeenCalledTimes(2)
    expect(catalog.getItems('mu', 'live').map((entry) => entry.name)).toEqual(['Kanal 1'])
  })

  it('does not fetch again for a removed source, and fails when the playlist keeps being dropped (K1)', async () => {
    const dropping = vi.fn(async (sourceId: string) => {
      const pending = ingestM3uText(sourceId, PLAYLIST, 'x.m3u')
      catalog.replaceSource(sourceId, null)
      return pending
    })
    await connectSource(urlSource, { ...deps(), ingestUrl: dropping, sourceExists: () => false })
    expect(dropping).toHaveBeenCalledTimes(1)

    dropping.mockClear()
    const error = await connectSource(urlSource, { ...deps(), ingestUrl: dropping, sourceExists: () => true }).catch(
      (caught: unknown) => caught
    )
    expect(dropping).toHaveBeenCalledTimes(3)
    expect(describeConnectFailure(error, 1, 0)).toMatchObject({ kind: 'other', retryAt: expect.any(Number) })
  })

  it('says once, in one sentence, why a file of the old version must be picked again (K7)', () => {
    const notPicked = new Error("Error invoking remote method 'read-picked-file': Error: Bu dosyayı okuma izni yok. Dosyayı yeniden seçin.")
    const message = fileReadFailureMessage(notPicked, null)
    expect(message.match(/seçin/g)).toHaveLength(1)
    expect(message.match(/\./g)).toHaveLength(1)
    expect(message).toMatch(/Dosyayı Yeniden Seç/)
    const withCopy = fileReadFailureMessage(notPicked, Date.UTC(2026, 10, 14, 18, 30))
    expect(withCopy).toMatch(/seçin; o zamana kadar dosyanın .+ tarihinde okunan kopyası gösteriliyor\.$/)
    expect(withCopy.match(/seçin/g)).toHaveLength(1)
    // Other failures keep their own reason and ask once.
    expect(fileReadFailureMessage(new Error('Dosya bulunamadı: a.m3u'), null)).toBe('Dosya bulunamadı: a.m3u Dosyayı yeniden seçin.')
  })
})

describe('useAutoConnect', () => {
  it('connects a provider that was down at startup by itself once it is back (F1-31)', async () => {
    vi.useFakeTimers()
    const authenticate = vi
      .spyOn(xtreamApi, 'authenticate')
      .mockRejectedValueOnce(new XtreamRequestError('network', 'Sunucuya bağlanılamadı.'))
      .mockRejectedValueOnce(new XtreamRequestError('network', 'Sunucuya bağlanılamadı.'))
      .mockResolvedValue(okAuth)
    useStore.setState({ sources: [xtream], activeSourceId: 'xt', credentialsHydrated: true })

    renderHook(() => useAutoConnect())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(authenticate).toHaveBeenCalledTimes(1)
    expect(useStore.getState().sourceErrors.xt).toMatchObject({ kind: 'other' })
    expect(useStore.getState().error).toMatch(/^Panel: /)
    expect(useStore.getState().isLoading).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(authenticate).toHaveBeenCalledTimes(2)
    // A background retry does not put the dashboard back on its loader.
    expect(useStore.getState().isLoading).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(authenticate).toHaveBeenCalledTimes(3)
    expect(useStore.getState().xtreamAuth.xt).toBe(okAuth)
    expect(useStore.getState().sourceErrors).toEqual({})
    expect(useStore.getState().error).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(authenticate).toHaveBeenCalledTimes(3)
  })

  it('stops retrying once the panel refuses the account, until the user asks again', async () => {
    vi.useFakeTimers()
    const authenticate = vi.spyOn(xtreamApi, 'authenticate').mockResolvedValue({ user_info: { auth: 0 } } as unknown as XtreamAuthResponse)
    useStore.setState({ sources: [xtream], activeSourceId: 'xt', credentialsHydrated: true })

    renderHook(() => useAutoConnect())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
    })
    expect(authenticate).toHaveBeenCalledTimes(1)
    expect(useStore.getState().sourceErrors.xt).toMatchObject({ kind: 'auth', retryAt: null })

    await act(async () => {
      useStore.getState().requestSourceReconnect()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(authenticate).toHaveBeenCalledTimes(2)
  })

  it('reads an unreadable secure store again instead of sending the user to delete the source (K3)', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const getAllSecrets = vi
      .spyOn(secureCredentialService, 'getAllSecrets')
      .mockRejectedValueOnce(new Error('kilit zaman aşımı'))
      .mockRejectedValueOnce(new Error('kilit zaman aşımı'))
      .mockResolvedValue({ xtream: { xt: { url: xtream.url!, username: 'ali', password: 's3cret' } }, m3uUrls: {} })
    const authenticate = vi.spyOn(xtreamApi, 'authenticate').mockResolvedValue(okAuth)
    const { username: _u, password: _p, ...persisted } = xtream
    useStore.setState({ sources: [persisted], activeSourceId: 'xt' })

    renderHook(() => useAutoConnect())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(useStore.getState().secretStoreError).toBe(SECRET_STORE_UNREADABLE_MESSAGE)
    expect(useStore.getState().sourceErrors.xt).toMatchObject({ kind: 'missing-secret', message: SECRETS_UNAVAILABLE_MESSAGE })
    expect(authenticate).not.toHaveBeenCalled()

    // Read again on a timer...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(getAllSecrets).toHaveBeenCalledTimes(2)

    // ...and at once when the user asks; the source then connects by itself.
    await act(async () => {
      useStore.getState().requestSourceReconnect()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getAllSecrets).toHaveBeenCalledTimes(3)
    expect(useStore.getState().secretStoreError).toBeNull()
    expect(authenticate).toHaveBeenCalledTimes(1)
    expect(useStore.getState().xtreamAuth.xt).toBe(okAuth)
    expect(useStore.getState().sourceErrors).toEqual({})
  })

  it('re-reads a local playlist file on start, and reports a missing one on the source (F1-27)', async () => {
    vi.mocked(readPickedFile).mockResolvedValueOnce({ path: fileSource.filePath!, content: PLAYLIST })
    useStore.setState({ sources: [fileSource], activeSourceId: 'mf', credentialsHydrated: true })
    const first = renderHook(() => useAutoConnect())
    await vi.waitFor(() => expect(catalog.getItems('mf', 'live')).toHaveLength(1))
    first.unmount()

    catalog.reset()
    vi.mocked(readPickedFile).mockRejectedValueOnce(new Error('Dosya bulunamadı: a.m3u'))
    renderHook(() => useAutoConnect())
    await vi.waitFor(() => expect(useStore.getState().sourceErrors.mf).toMatchObject({ kind: 'file', retryAt: null }))
    expect(useStore.getState().sourceErrors.mf?.message).toMatch(/yeniden seçin/)
  })
})

describe('secret migration (F3-02, F1-56)', () => {
  const partialize = () => createPartialize()(useStore.getState() as AppStore)

  it('plans writes only for legacy plain secrets the secure store lacks', () => {
    const plan = planSecretMigration([xtream, urlSource, fileSource], ['xt', 'mu'], {
      xtream: { xt: { url: 'http://panel.test', username: 'ali', password: 's3cret' } },
      m3uUrls: {}
    })
    expect(plan.alreadyStored).toEqual(['xt'])
    expect(plan.writes).toEqual([{ sourceId: 'mu', secret: { m3uUrl: urlSource.url } }])
  })

  it('moves a plain M3U URL to the secure store and only then stops persisting it', async () => {
    const setM3uUrl = vi.spyOn(secureCredentialService, 'setM3uUrl').mockResolvedValue()
    vi.spyOn(secureCredentialService, 'getAllSecrets').mockResolvedValue({ xtream: {}, m3uUrls: {} })
    useStore.setState({ sources: [urlSource], legacySecretSourceIds: ['mu'] })
    expect(partialize().sources[0]?.url).toBe(urlSource.url)

    await hydrateSecrets()

    expect(setM3uUrl).toHaveBeenCalledWith('mu', urlSource.url)
    expect(useStore.getState().legacySecretSourceIds).toEqual([])
    expect(useStore.getState().sources[0]?.url).toBe(urlSource.url)
    expect(partialize().sources[0]).not.toHaveProperty('url')
    expect(useStore.getState().secretMigrationError).toBeNull()
  })

  it('keeps the plain copy and tells the user when the secure write fails', async () => {
    vi.spyOn(secureCredentialService, 'getAllSecrets').mockResolvedValue({ xtream: {}, m3uUrls: {} })
    vi.spyOn(secureCredentialService, 'set').mockRejectedValue(new Error('Güvenli depo yazılamadı'))
    vi.spyOn(secureCredentialService, 'setM3uUrl').mockRejectedValue(new Error('Güvenli depo yazılamadı'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    useStore.setState({ sources: [xtream, urlSource], legacySecretSourceIds: ['xt', 'mu'] })

    await hydrateSecrets()

    expect(useStore.getState().credentialsHydrated).toBe(true)
    expect(useStore.getState().legacySecretSourceIds).toEqual(['xt', 'mu'])
    expect(useStore.getState().secretMigrationError).toBe(SECRET_MIGRATION_FAILED_MESSAGE)
    // Next launch still finds them.
    const persisted = partialize()
    expect(persisted.sources[0]).toMatchObject({ username: 'ali', password: 's3cret' })
    expect(persisted.sources[1]).toMatchObject({ url: urlSource.url })
  })

  it('keeps plain copies when the secure store cannot be read at all', async () => {
    vi.spyOn(secureCredentialService, 'getAllSecrets').mockRejectedValue(new Error('kilit zaman aşımı'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    useStore.setState({ sources: [xtream], legacySecretSourceIds: ['xt'] })

    await hydrateSecrets()

    expect(useStore.getState().credentialsHydrated).toBe(true)
    expect(useStore.getState().secretMigrationError).toBe(SECRET_MIGRATION_FAILED_MESSAGE)
    expect(partialize().sources[0]).toMatchObject({ password: 's3cret' })
  })

  it('moves a plain TMDB key to the secure store and only then stops persisting it (K10)', async () => {
    vi.spyOn(secureCredentialService, 'getAllSecrets').mockResolvedValue({ xtream: {}, m3uUrls: {} })
    vi.spyOn(secureCredentialService, 'getTmdbApiKey').mockResolvedValue(null)
    const setTmdbApiKey = vi.spyOn(secureCredentialService, 'setTmdbApiKey').mockRejectedValueOnce(new Error('yazılamadı'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    useStore.getState().updateSettings({ tmdbApiKey: 'plain-tmdb-key' })
    useStore.setState({ tmdbKeyPlainPending: true })

    await hydrateSecrets()
    // The write failed: the plain copy stays for the next start.
    expect(partialize().settings.tmdbApiKey).toBe('plain-tmdb-key')
    expect(useStore.getState().secretMigrationError).toBe(SECRET_MIGRATION_FAILED_MESSAGE)

    setTmdbApiKey.mockResolvedValue()
    await hydrateSecrets()
    expect(setTmdbApiKey).toHaveBeenLastCalledWith('plain-tmdb-key')
    expect(useStore.getState().settings.tmdbApiKey).toBe('plain-tmdb-key')
    expect(partialize().settings).not.toHaveProperty('tmdbApiKey')
    expect(useStore.getState().secretMigrationError).toBeNull()
    useStore.getState().updateSettings({ tmdbApiKey: '' })
  })

  it('puts the stored TMDB key in the settings', async () => {
    vi.spyOn(secureCredentialService, 'getAllSecrets').mockResolvedValue({ xtream: {}, m3uUrls: {} })
    vi.spyOn(secureCredentialService, 'getTmdbApiKey').mockResolvedValue('stored-tmdb-key')
    await hydrateSecrets()
    expect(useStore.getState().settings.tmdbApiKey).toBe('stored-tmdb-key')
    useStore.getState().updateSettings({ tmdbApiKey: '' })
  })

  it('puts stored URLs on M3U sources that have none in memory', async () => {
    vi.spyOn(secureCredentialService, 'getAllSecrets').mockResolvedValue({
      xtream: {},
      m3uUrls: { mu: urlSource.url! }
    })
    const { url: _url, ...persisted } = urlSource
    useStore.setState({ sources: [persisted] })

    await hydrateSecrets()

    expect(useStore.getState().sources[0]?.url).toBe(urlSource.url)
    expect(partialize().sources[0]).not.toHaveProperty('url')
  })
})
