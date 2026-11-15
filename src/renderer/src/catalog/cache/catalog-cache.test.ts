import { describe, expect, it } from 'vitest'
import type { CatalogCategory, CatalogItem } from '../types'
import { MemoryCacheBackend } from './backend'
import { CatalogCache, type SourceIdentity } from './catalog-cache'
import { createCacheCipher } from './cipher'
import { CACHE_SCHEMA_VERSION, manifestKey } from './schema'

const XTREAM: SourceIdentity = { kind: 'xtream', url: 'http://panel.test', username: 'ali' }
const M3U: SourceIdentity = { kind: 'm3u_url', url: 'http://panel.test/get.php?username=ali&password=GizliSifre' }

function live(count: number, sourceId = 's', from = 0): CatalogItem[] {
  return Array.from({ length: count }, (_, index) => {
    const n = from + index
    return { id: `${sourceId}_live_${n}`, name: `Kanal ${n}`, streamUrl: '', streamId: n, sourceId, type: 'live', searchName: `kanal ${n}`, isAdult: false }
  })
}

function m3uItems(count: number): CatalogItem[] {
  return Array.from({ length: count }, (_, n) => ({
    id: `m_m3u_ch_${n}`,
    name: `Kanal ${n}`,
    streamUrl: `http://panel.test/live/ali/GizliSifre/${n}.ts`,
    sourceId: 'm',
    type: 'live',
    searchName: `kanal ${n}`,
    isAdult: false
  }))
}

const CATEGORIES: CatalogCategory[] = [{ id: 's_live_1', name: 'Ulusal', sourceId: 's', type: 'live', isAdult: false }]

async function readAll(cache: CatalogCache, sourceId: string, identity: SourceIdentity) {
  const result = await cache.read(sourceId, identity, ['live', 'vod', 'series'])
  if (result.status !== 'hit') return { result, items: [] as CatalogItem[], categories: null as CatalogCategory[] | null }
  const items: CatalogItem[] = []
  let categories: CatalogCategory[] | null = null
  for (const { manifest } of result.partitions) {
    for await (const chunk of cache.readItems(manifest)) items.push(...chunk)
    categories = (await cache.readCategories(manifest)) ?? categories
  }
  return { result, items, categories }
}

function write(cache: CatalogCache, items: CatalogItem[], options: { revision?: number; identity?: SourceIdentity; sourceId?: string; shouldPublish?: () => boolean } = {}) {
  return cache.write({
    sourceId: options.sourceId ?? 's',
    identity: options.identity ?? XTREAM,
    sourceRevision: options.revision ?? 1,
    fetchedAt: 1_000,
    partitions: [{ partition: 'live', items, categories: CATEGORIES }],
    shouldPublish: options.shouldPublish
  })
}

describe('catalog cache: generations and the manifest', () => {
  it('publishes a complete generation and reads it back in order, with its categories', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend, { now: () => 5_000 })
    const items = live(10_000)

    const report = await write(cache, items)

    expect(report).toMatchObject({ published: true, recordsTotal: 10_000, recordsWritten: 10_000 })
    expect(report.chunksWritten).toBe(report.chunksTotal)
    const manifest = backend.manifests.get(manifestKey('s', 'live'))!
    expect(manifest).toMatchObject({ schema: CACHE_SCHEMA_VERSION, complete: true, generation: 1, itemCount: 10_000, fetchedAt: 1_000, writtenAt: 5_000, keyId: null })
    const { items: back, categories } = await readAll(cache, 's', XTREAM)
    expect(back).toEqual(items)
    expect(categories).toEqual(CATEGORIES)
  })

  it('discards a cache of another schema or another source configuration instead of using it', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend)
    await write(cache, live(10))

    expect(await cache.read('s', { ...XTREAM, username: 'veli' }, ['live'])).toEqual({ status: 'discarded', reason: 'fingerprint' })
    expect(backend.manifests.size).toBe(0)
    expect(backend.chunks.size).toBe(0)

    await write(cache, live(10))
    backend.manifests.get(manifestKey('s', 'live'))!.schema = CACHE_SCHEMA_VERSION + 1
    expect(await cache.read('s', XTREAM, ['live'])).toEqual({ status: 'discarded', reason: 'schema' })
    expect(backend.chunks.size).toBe(0)
  })

  it('keeps the previous generation when the process dies before the manifest switch, and collects the orphans later', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend)
    const old = live(3_000)
    await write(cache, old)
    const oldChunks = new Set(backend.chunks.keys())

    // The crash: chunks of the new generation are written, the switch never happens.
    const crashed = new MemoryCacheBackend()
    for (const [key, value] of backend.manifests) crashed.manifests.set(key, value)
    for (const [key, value] of backend.chunks) crashed.chunks.set(key, value)
    crashed.failNextPublish = true
    const before = new CatalogCache(crashed)
    await expect(write(before, live(3_000, 's', 100_000))).rejects.toThrow('simulated crash')
    // (A real crash leaves the new chunks behind; put them back as it would.)
    const after = new CatalogCache(crashed)
    await after.write({ sourceId: 'x', identity: XTREAM, sourceRevision: 1, fetchedAt: 1, partitions: [{ partition: 'live', items: live(500, 'x'), categories: null }] })
    crashed.manifests.delete(manifestKey('x', 'live'))

    // On the next start the old generation is what is read...
    expect((await readAll(after, 's', XTREAM)).items).toEqual(old)
    // ...and garbage collection keeps exactly its chunks.
    await after.collectGarbage(['s'])
    expect(new Set(crashed.chunks.keys())).toEqual(oldChunks)
  })

  it('leaves the previous generation untouched when the disk is full', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend)
    const old = live(2_000)
    await write(cache, old)
    const stored = new Set(backend.chunks.keys())

    backend.quotaAfterChunks = backend.chunkWrites + 1
    const report = await write(cache, live(9_000, 's', 50_000))

    expect(report).toMatchObject({ published: false, skipped: 'quota' })
    expect(new Set(backend.chunks.keys())).toEqual(stored)
    expect((await readAll(cache, 's', XTREAM)).items).toEqual(old)
  })

  it('deletes the previous generation once the new one is published, but not while it is being read', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend)
    await write(cache, live(2_000))
    const oldKeys = [...backend.manifests.get(manifestKey('s', 'live'))!.chunks]

    cache.beginRead('s')
    await write(cache, live(2_000, 's', 9_000))
    expect(oldKeys.every((key) => backend.chunks.has(key))).toBe(true)
    await cache.endRead('s')
    expect(oldKeys.some((key) => backend.chunks.has(key))).toBe(false)
    expect(backend.manifests.get(manifestKey('s', 'live'))!.generation).toBe(2)
  })

  it('drops late writes for a removed source, also one that is half way through', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend)
    await write(cache, live(100), { revision: 3 })
    await cache.dropSource('s', 3)
    expect(backend.manifests.size + backend.chunks.size).toBe(0)

    expect(await write(cache, live(100), { revision: 3 })).toMatchObject({ published: false, skipped: 'removed' })
    expect(backend.manifests.size + backend.chunks.size).toBe(0)

    // The removal arrives while the write is staging its chunks.
    const racing = new CatalogCache(new MemoryCacheBackend())
    let calls = 0
    const report = await write(racing, live(20_000), {
      revision: 7,
      shouldPublish: () => {
        calls += 1
        if (calls === 2) void racing.dropSource('s', 7)
        return true
      }
    })
    expect(report).toMatchObject({ published: false, skipped: 'removed' })

    // A source re-added under the same id later writes normally.
    expect(await write(cache, live(10), { revision: 4 })).toMatchObject({ published: true })
  })

  it('empties the database when no source is left', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend)
    await write(cache, live(100))
    await write(cache, live(100, 't'), { sourceId: 't' })
    await cache.collectGarbage(['t'])
    expect([...backend.manifests.values()].map((manifest) => manifest.sourceId)).toEqual(['t'])
    await cache.collectGarbage([])
    expect(backend.manifests.size + backend.chunks.size).toBe(0)
  })
})

describe('catalog cache: writing only what changed', () => {
  it('writes nothing for an unchanged refresh and one or two chunks for a single change', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend)
    const items = live(50_000)
    const first = await write(cache, items)

    const same = await write(cache, items)
    expect(same).toMatchObject({ published: true, chunksWritten: 0, recordsWritten: 0, chunksTotal: first.chunksTotal })

    const renamed = items.map((item, index) => (index === 25_000 ? { ...item, name: 'Yeni Ad' } : item))
    const changed = await write(cache, renamed)
    expect(changed.chunksWritten).toBeGreaterThanOrEqual(1)
    expect(changed.chunksWritten).toBeLessThanOrEqual(2)
    expect(changed.recordsWritten / changed.recordsTotal).toBeLessThan(0.15)

    // An insertion shifts no boundary but its neighbours'.
    const inserted = [...renamed.slice(0, 10_000), ...live(1, 's', 999_999), ...renamed.slice(10_000)]
    const grown = await write(cache, inserted)
    expect(grown.chunksWritten).toBeLessThanOrEqual(3)
    expect((await readAll(cache, 's', XTREAM)).items).toEqual(inserted)
  })
})

describe('catalog cache: sealed M3U data', () => {
  const key = (fill: number) => new Uint8Array(32).fill(fill)

  it('stores M3U chunks only sealed and reads them back', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend)
    cache.setCipher(await createCacheCipher(key(7)))
    const items = m3uItems(3_000)
    await cache.write({
      sourceId: 'm',
      identity: M3U,
      sourceRevision: 1,
      fetchedAt: 1,
      partitions: [{ partition: 'live', items, categories: [] }],
      extra: { epgUrls: ['http://panel.test/xmltv.php?username=ali&password=GizliSifre'] }
    })

    const raw = JSON.stringify([...backend.chunks.values(), ...backend.manifests.values()], (_key, value: unknown) =>
      value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? new TextDecoder('latin1').decode(value as ArrayBuffer) : value
    )
    for (const secret of ['GizliSifre', '/live/ali/', 'get.php', 'Kanal 1', 'xmltv.php']) expect(raw).not.toContain(secret)
    expect([...backend.chunks.values()].every((chunk) => chunk.sealed && !chunk.items)).toBe(true)

    const read = await cache.read('m', M3U, ['live'])
    expect(read).toMatchObject({ status: 'hit', extra: { epgUrls: ['http://panel.test/xmltv.php?username=ali&password=GizliSifre'] } })
    expect((await readAll(cache, 'm', M3U)).items).toEqual(items)
  })

  it('discards the M3U cache when the key was lost, and does not cache M3U without a key', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend)
    cache.setCipher(await createCacheCipher(key(1)))
    await cache.write({ sourceId: 'm', identity: M3U, sourceRevision: 1, fetchedAt: 1, partitions: [{ partition: 'live', items: m3uItems(10), categories: [] }] })

    // The credential file was quarantined: main made a new key.
    cache.setCipher(await createCacheCipher(key(2)))
    expect(await cache.read('m', M3U, ['live'])).toEqual({ status: 'discarded', reason: 'key' })
    expect(backend.manifests.size + backend.chunks.size).toBe(0)

    cache.setCipher(null)
    const report = await cache.write({ sourceId: 'm', identity: M3U, sourceRevision: 1, fetchedAt: 1, partitions: [{ partition: 'live', items: m3uItems(10), categories: [] }] })
    expect(report).toMatchObject({ published: false, skipped: 'no-key' })
  })
})

describe('catalog cache: EPG', () => {
  it('replaces the previous guide and drops it with its source', async () => {
    const backend = new MemoryCacheBackend()
    const cache = new CatalogCache(backend)
    const channels = Array.from({ length: 1_200 }, (_, n) => ({ key: `k${n}`, channel: null, programs: [] }))
    expect(await cache.writeEpg({ sourceId: 's', identity: XTREAM, sourceRevision: 1, fetchedAt: 10, channels, truncated: null })).toBe(true)
    expect(await cache.writeEpg({ sourceId: 's', identity: XTREAM, sourceRevision: 1, fetchedAt: 20, channels: channels.slice(0, 2), truncated: 'cut-off' })).toBe(true)

    const read = await cache.readEpg('s', XTREAM)
    expect(read?.manifest).toMatchObject({ fetchedAt: 20, epgTruncated: 'cut-off' })
    expect(read?.channels).toHaveLength(2)
    expect(backend.chunks.size).toBe(1)

    await cache.dropSource('s', 1)
    expect(await cache.readEpg('s', XTREAM)).toBeNull()
  })
})
