import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/m3u-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/m3u-parser')>()
  return { ...actual, fetchAndParseM3U: vi.fn() }
})
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
import type { PlaylistSource } from '@/types/playlist'
import type { XtreamAuthResponse } from '@/types/xtream'
import {
  connectSource,
  describeConnectFailure,
  hydrateSecrets,
  planSecretMigration,
  reconnectDelayMs,
  SECRET_MIGRATION_FAILED_MESSAGE,
  SourceConnectError,
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
    secretMigrationError: null
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

describe('connectSource', () => {
  const deps = () => ({ setXtreamAuth: vi.fn(), replaceSourceCatalog: vi.fn() })

  it('reads a local playlist file again on start (F1-27)', async () => {
    const d = deps()
    const readFile = vi.fn().mockResolvedValue({ path: fileSource.filePath, content: PLAYLIST })
    await connectSource(fileSource, { ...d, readFile })
    expect(readFile).toHaveBeenCalledWith('C:\\listeler\\a.m3u')
    const [sourceId, replacement] = d.replaceSourceCatalog.mock.calls[0]
    expect(sourceId).toBe('mf')
    expect(replacement.live.items.map((entry: { name: string }) => entry.name)).toEqual(['Kanal 1'])
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

  it('needs the stored secret', async () => {
    const { url: _url, ...withoutUrl } = urlSource
    await expect(connectSource(withoutUrl, deps())).rejects.toMatchObject({ kind: 'missing-secret' })
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
    expect(useStore.getState().sourceErrors.mf.message).toMatch(/yeniden seçin/)
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
    expect(partialize().sources[0].url).toBe(urlSource.url)

    await hydrateSecrets()

    expect(setM3uUrl).toHaveBeenCalledWith('mu', urlSource.url)
    expect(useStore.getState().legacySecretSourceIds).toEqual([])
    expect(useStore.getState().sources[0].url).toBe(urlSource.url)
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

  it('puts stored URLs on M3U sources that have none in memory', async () => {
    vi.spyOn(secureCredentialService, 'getAllSecrets').mockResolvedValue({
      xtream: {},
      m3uUrls: { mu: urlSource.url! }
    })
    const { url: _url, ...persisted } = urlSource
    useStore.setState({ sources: [persisted] })

    await hydrateSecrets()

    expect(useStore.getState().sources[0].url).toBe(urlSource.url)
    expect(partialize().sources[0]).not.toHaveProperty('url')
  })
})
