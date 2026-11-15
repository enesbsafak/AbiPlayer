import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sync = vi.hoisted(() => ({ ensureStagedSync: vi.fn(async () => undefined), ensureFullSync: vi.fn(async () => undefined) }))
vi.mock('@/services/background-sync', () => sync)

const ingest = vi.hoisted(() => ({
  ingestM3uUrl: vi.fn(),
  ingestM3uText: vi.fn(),
  ingestFromCache: vi.fn(async () => null)
}))
vi.mock('./worker-ingest', async (importOriginal) => ({ ...(await importOriginal<typeof import('./worker-ingest')>()), ...ingest }))

import { useStore } from '@/store'
import type { PlaylistSource } from '@/types/playlist'
import { catalog } from './catalog-store'
import { m3uEntryToRecord } from './convert'
import { reloadAfterCertificateTrust, reloadSourceCatalog } from './cache-lifecycle'

const xtream: PlaylistSource = { id: 'xt', name: 'Panel', type: 'xtream', url: 'https://panel.test', username: 'u', password: 'p', addedAt: 1 }
const m3u: PlaylistSource = { id: 'mu', name: 'Liste', type: 'm3u_url', url: 'https://panel.test/get.php', addedAt: 1 }

const outcome = (result: 'committed' | 'stale') => ({
  results: { live: result, vod: result, series: result },
  counts: {},
  meta: null,
  epgUrls: [],
  job: { kind: 'ok' as const }
})

beforeEach(() => {
  catalog.reset()
  sync.ensureStagedSync.mockClear()
  ingest.ingestM3uUrl.mockReset()
  useStore.setState({ sources: [xtream, m3u], sourceErrors: {} })
})

afterEach(() => {
  catalog.reset()
  useStore.setState({ sources: [], sourceErrors: {} })
})

describe('reloadAfterCertificateTrust (C2c follow-up)', () => {
  it('fetches the Xtream lists that are not fresh, keeping complete fresh ones', async () => {
    await reloadAfterCertificateTrust('xt')
    expect(sync.ensureStagedSync).toHaveBeenCalledWith('xt', 'live', { url: 'https://panel.test', username: 'u', password: 'p' }, { refresh: false })
  })

  it('leaves an M3U source that is not connected to its reconnect, and reloads a connected one', async () => {
    await reloadAfterCertificateTrust('mu')
    expect(ingest.ingestM3uUrl).not.toHaveBeenCalled()

    catalog.commit({
      token: catalog.beginGeneration('mu', 'live'),
      mode: 'replace',
      items: [m3uEntryToRecord({ id: 'a', name: 'A', streamUrl: 'https://cdn.test/a.ts', sourceId: 'mu', type: 'live' })]
    })
    ingest.ingestM3uUrl.mockResolvedValue(outcome('committed'))
    await reloadAfterCertificateTrust('mu')
    expect(ingest.ingestM3uUrl).toHaveBeenCalledWith('mu', m3u.url)
  })
})

describe('reloadSourceCatalog (K1)', () => {
  it('fails when what it fetched was dropped while the source still exists', async () => {
    ingest.ingestM3uUrl.mockResolvedValue(outcome('stale'))
    await expect(reloadSourceCatalog('mu')).rejects.toThrow(/Tekrar deneyin/)

    useStore.setState({ sources: [xtream] })
    await expect(reloadSourceCatalog('mu')).resolves.toBeUndefined()
  })
})
