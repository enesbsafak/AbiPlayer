import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '@/store'
import { createCatalogStore } from '@/catalog/catalog-store'
import type { CatalogWorkerClient, JobHandlers } from '@/workers/client'
import type { JobResult, WorkerJob } from '@/workers/protocol'
import type { PlaylistSource } from '@/types/playlist'
import { createEpgLoader } from './useEPG'

const sourceA: PlaylistSource = { id: 'a', name: 'A', type: 'xtream', url: 'http://a.test', username: 'u', password: 'p', addedAt: 1 }
const sourceB: PlaylistSource = { id: 'b', name: 'B', type: 'xtream', url: 'http://b.test', username: 'u', password: 'p', addedAt: 2 }

interface Call {
  job: WorkerJob
  handlers: JobHandlers
  signal?: AbortSignal
  resolve(result: JobResult): void
  reject(error: unknown): void
}

/** A worker whose EPG jobs answer when the test says so. */
function fakeWorker(): { client: () => CatalogWorkerClient; calls: Call[] } {
  const calls: Call[] = []
  const run = (job: WorkerJob, handlers: JobHandlers = {}, signal?: AbortSignal) => {
    if (job.kind === 'epg-cache-read') return Promise.resolve<JobResult>({ kind: 'cache-miss', reason: 'empty' })
    return new Promise<JobResult>((resolve, reject) => {
      calls.push({ job, handlers, signal, resolve, reject })
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })
  }
  const client = { run, start: () => { throw new Error('unused') }, putItems: () => undefined, setKey: () => undefined, isolated: false, terminate: () => undefined } as unknown as CatalogWorkerClient
  return { client: () => client, calls }
}

function answer(call: Call, title: string) {
  call.handlers.onEpgBatch?.([{ id: 'k', displayName: 'K' }], [['k', [{ channelId: 'k', title, start: 0, end: Date.now() + 3600_000 }]]])
  call.resolve({ kind: 'epg', meta: { fetchedAt: Date.now(), truncated: null, channels: 1, programmes: 1, origin: 'network' } })
}

beforeEach(() => {
  useStore.setState({ sources: [sourceA, sourceB], activeSourceId: 'a' })
  useStore.getState().clearEpg()
})

afterEach(() => {
  useStore.setState({ sources: [], activeSourceId: null })
  useStore.getState().clearEpg()
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('EPG loading (F1-30)', () => {
  it('cancels the guide of the previous source on a switch and never applies it', async () => {
    const worker = fakeWorker()
    const loader = createEpgLoader({ worker: worker.client, catalog: createCatalogStore() })

    const first = loader.load('a')
    await flush()
    expect(worker.calls).toHaveLength(1)
    expect(worker.calls[0].job).toMatchObject({ kind: 'epg', sourceId: 'a' })

    // Switching sources used to wait for A's download to finish.
    useStore.setState({ activeSourceId: 'b' })
    const second = loader.load('b')
    await flush()
    expect(worker.calls[0].signal?.aborted).toBe(true)
    expect(worker.calls).toHaveLength(2)
    expect(worker.calls[1].job).toMatchObject({ kind: 'epg', sourceId: 'b' })

    answer(worker.calls[1], 'B programı')
    await second
    await first
    expect(useStore.getState().epgSourceId).toBe('b')
    expect(useStore.getState().epgData?.programs['k'][0].title).toBe('B programı')
    expect(useStore.getState().epgLoading).toBe(false)
  })

  it('does not apply a guide that arrives after its source stopped being the active one', async () => {
    const worker = fakeWorker()
    const loader = createEpgLoader({ worker: worker.client, catalog: createCatalogStore() })
    const load = loader.load('a')
    await flush()
    useStore.setState({ activeSourceId: 'b' })
    answer(worker.calls[0], 'Geç kalan')
    await load
    expect(useStore.getState().epgData).toBeNull()
    expect(useStore.getState().epgLoading).toBe(false)
  })

  it('shares one load per source unless forced', async () => {
    const worker = fakeWorker()
    const loader = createEpgLoader({ worker: worker.client, catalog: createCatalogStore() })
    void loader.load('a')
    void loader.load('a')
    await flush()
    expect(worker.calls).toHaveLength(1)
    void loader.load('a', { force: true })
    await flush()
    expect(worker.calls).toHaveLength(2)
    expect(worker.calls[0].signal?.aborted).toBe(true)
    loader.cancel()
  })
})
