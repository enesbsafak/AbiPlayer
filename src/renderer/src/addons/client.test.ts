import { describe, expect, it } from 'vitest'
import { classifyError, toUserMessage } from '@/services/user-error'
import { XtreamRequestError } from '@/services/xtream-errors'
import { toCatalogSyncError } from '@/catalog/sync-error'
import { addonHost, addonResourceUrl, normalizeAddonAddress } from './address'
import {
  ADDON_MAX_BYTES,
  fetchAddonCatalogPage,
  fetchAddonManifest,
  fetchAddonMeta,
  fetchAddonStreams,
  parseCatalogPage,
  parseMeta,
  parseStreams
} from './client'
import { fetchAddonJson } from './request'
import { CATALOG_BASE, CATALOG_MANIFEST, SECRET_SEGMENT, STREAM_URL, jsonResponse, metas, routeFetch } from './testing/fixtures'

async function failure(promise: Promise<unknown>): Promise<XtreamRequestError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(XtreamRequestError)
    return error as XtreamRequestError
  }
  throw new Error('expected a rejection')
}

/** Nothing that reaches a message, a log or the UI may hold the address or its settings. */
function expectNoSecret(error: XtreamRequestError) {
  const shown = [error.message, String(error), toUserMessage(error), JSON.stringify(toCatalogSyncError(error)), String(error.cause ?? '')]
  for (const text of shown) {
    expect(text).not.toContain(SECRET_SEGMENT)
    expect(text).not.toContain(CATALOG_BASE)
  }
}

describe('normalizeAddonAddress', () => {
  it('turns a pasted manifest link into the base address', () => {
    expect(normalizeAddonAddress(`  ${CATALOG_BASE}/manifest.json  `)).toEqual({ ok: true, base: CATALOG_BASE })
    expect(normalizeAddonAddress(`${CATALOG_BASE}/manifest.json?ref=paylasim#x`)).toEqual({ ok: true, base: CATALOG_BASE })
    expect(normalizeAddonAddress(`${CATALOG_BASE}/`)).toEqual({ ok: true, base: CATALOG_BASE })
    expect(normalizeAddonAddress('http://127.0.0.1:7000/manifest.json')).toEqual({ ok: true, base: 'http://127.0.0.1:7000' })
  })

  it('reads stremio:// and scheme-less links as https', () => {
    expect(normalizeAddonAddress(`stremio://addon.example/${SECRET_SEGMENT}/manifest.json`)).toEqual({ ok: true, base: CATALOG_BASE })
    expect(normalizeAddonAddress(`addon.example/${SECRET_SEGMENT}/manifest.json`)).toEqual({ ok: true, base: CATALOG_BASE })
    expect(normalizeAddonAddress('ADDON.example/manifest.json')).toEqual({ ok: true, base: 'https://addon.example' })
  })

  it('rejects anything that is not http or https', () => {
    expect(normalizeAddonAddress('   ')).toEqual({ ok: false, problem: 'empty' })
    expect(normalizeAddonAddress('ftp://addon.example/manifest.json')).toEqual({ ok: false, problem: 'unsupported-protocol' })
    expect(normalizeAddonAddress('file:///C:/eklenti/manifest.json')).toEqual({ ok: false, problem: 'unsupported-protocol' })
    expect(normalizeAddonAddress('javascript:alert(1)').ok).toBe(false)
    expect(normalizeAddonAddress('https://kullanici:sifre@addon.example/manifest.json')).toEqual({ ok: false, problem: 'invalid' })
    expect(normalizeAddonAddress('https://')).toEqual({ ok: false, problem: 'invalid' })
    expect(normalizeAddonAddress(`https://addon.example/${'a'.repeat(9000)}`)).toEqual({ ok: false, problem: 'too-long' })
  })

  it('shows only the host', () => {
    expect(addonHost(CATALOG_BASE)).toBe('addon.example')
    expect(addonHost('http://127.0.0.1:7000')).toBe('127.0.0.1:7000')
    expect(addonHost('kotu')).toBeNull()
  })

  it('builds resource paths with every part encoded', () => {
    expect(addonResourceUrl(CATALOG_BASE, 'stream', 'series', 'tt0000001:1:2')).toBe(`${CATALOG_BASE}/stream/series/tt0000001%3A1%3A2.json`)
    expect(addonResourceUrl(CATALOG_BASE, 'catalog', 'movie', 'en iyi', [['skip', 50]])).toBe(
      `${CATALOG_BASE}/catalog/movie/en%20iyi/skip=50.json`
    )
    expect(addonResourceUrl(CATALOG_BASE, 'catalog', 'movie', 'a', [['skip', 0], ['genre', 'Bilim & Kurgu']])).toBe(
      `${CATALOG_BASE}/catalog/movie/a/skip=0&genre=Bilim%20%26%20Kurgu.json`
    )
  })
})

describe('fetchAddonJson failures', () => {
  const url = `${CATALOG_BASE}/manifest.json`

  it('maps an unreachable host to a network error that names the host only', async () => {
    const error = await failure(
      fetchAddonJson(url, { maxBytes: 1000, fetchImpl: async () => Promise.reject(new TypeError(`Failed to fetch ${url}`)) })
    )
    expect(error.kind).toBe('network')
    expect(error.host).toBe('addon.example')
    expect(classifyError(error)).toBe('network')
    expectNoSecret(error)
  })

  it('maps HTTP failures with their status, without the body', async () => {
    const error = await failure(
      fetchAddonJson(url, { maxBytes: 1000, fetchImpl: async () => new Response(`yok: ${url}`, { status: 404 }) })
    )
    expect(error.kind).toBe('http')
    expect(error.status).toBe(404)
    expect(error.retryable).toBe(false)
    expectNoSecret(error)
    const busy = await failure(fetchAddonJson(url, { maxBytes: 1000, fetchImpl: async () => new Response('', { status: 503 }) }))
    expect(busy.retryable).toBe(true)
  })

  it('refuses a body that is not JSON without quoting it', async () => {
    const error = await failure(fetchAddonJson(url, { maxBytes: 1000, fetchImpl: async () => new Response(`<html>${url}</html>`) }))
    expect(error.kind).toBe('bad-response')
    expectNoSecret(error)
  })

  it('refuses a body over the limit, declared or not', async () => {
    const declared = await failure(
      fetchAddonJson(url, {
        maxBytes: 10,
        fetchImpl: async () => new Response('{"a":"0123456789"}', { headers: { 'content-length': '18' } })
      })
    )
    expect(declared.kind).toBe('bad-response')
    const streamed = await failure(
      fetchAddonJson(url, {
        maxBytes: 10,
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"a":"012345'))
                controller.enqueue(new TextEncoder().encode('6789"}'))
                controller.close()
              }
            })
          )
      })
    )
    expect(streamed.kind).toBe('bad-response')
  })

  it('times out the whole request', async () => {
    const error = await failure(
      fetchAddonJson(url, {
        maxBytes: 1000,
        timeoutMs: 10,
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
      })
    )
    expect(error.kind).toBe('timeout')
    expectNoSecret(error)
  })

  it('reports a cancel as aborted', async () => {
    const controller = new AbortController()
    const pending = fetchAddonJson(url, {
      maxBytes: 1000,
      signal: controller.signal,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    })
    controller.abort()
    const error = await failure(pending)
    expect(error.kind).toBe('aborted')
    expect(toCatalogSyncError(error)).toBeNull()
  })

  it('asks without cookies and without the HTTP cache', async () => {
    let seen: RequestInit | undefined
    await fetchAddonJson(url, {
      maxBytes: 1000,
      fetchImpl: async (_input, init) => {
        seen = init
        return jsonResponse({})
      }
    })
    expect(seen).toMatchObject({ credentials: 'omit', cache: 'no-store' })
  })
})

describe('add-on requests', () => {
  it('fetches and summarises the manifest', async () => {
    const fetchImpl = routeFetch({ [`${CATALOG_BASE}/manifest.json`]: () => jsonResponse(CATALOG_MANIFEST) })
    const summary = await fetchAddonManifest(CATALOG_BASE, { fetchImpl })
    expect(summary).toMatchObject({ id: 'org.ornek.katalog', name: 'Örnek Katalog', version: '1.2.0', adult: false })
    expect(fetchImpl.calls).toEqual([`${CATALOG_BASE}/manifest.json`])
  })

  it('refuses a manifest of the wrong shape as a bad response', async () => {
    const fetchImpl = routeFetch({ [`${CATALOG_BASE}/manifest.json`]: () => jsonResponse({ name: 'Eksik' }) })
    const error = await failure(fetchAddonManifest(CATALOG_BASE, { fetchImpl }))
    expect(error.kind).toBe('bad-response')
    expectNoSecret(error)
  })

  it('pages a catalogue with skip', async () => {
    const fetchImpl = routeFetch({
      [`${CATALOG_BASE}/catalog/movie/populer.json`]: () => jsonResponse({ metas: metas('tt', 1, 3) }),
      [`${CATALOG_BASE}/catalog/movie/populer/skip=3.json`]: () => jsonResponse({ metas: [] })
    })
    expect((await fetchAddonCatalogPage(CATALOG_BASE, { type: 'movie', id: 'populer' }, 0, { fetchImpl })).metas).toHaveLength(3)
    expect(await fetchAddonCatalogPage(CATALOG_BASE, { type: 'movie', id: 'populer' }, 3, { fetchImpl })).toEqual({ metas: [], received: 0 })
  })

  it('fetches a meta and the streams of a video', async () => {
    const fetchImpl = routeFetch({
      [`${CATALOG_BASE}/meta/series/tt0000009.json`]: () => jsonResponse({ meta: { id: 'tt0000009', type: 'series', name: 'Örnek Dizi' } }),
      [`${CATALOG_BASE}/stream/series/tt0000009%3A1%3A1.json`]: () => jsonResponse({ streams: [{ url: STREAM_URL, name: 'Kaynak\n1080p' }] })
    })
    expect((await fetchAddonMeta(CATALOG_BASE, 'series', 'tt0000009', { fetchImpl })).name).toBe('Örnek Dizi')
    expect(await fetchAddonStreams(CATALOG_BASE, 'series', 'tt0000009:1:1', { fetchImpl })).toEqual([
      expect.objectContaining({ url: STREAM_URL, name: 'Kaynak\n1080p' })
    ])
  })

  it('keeps per-request limits sensible', () => {
    expect(ADDON_MAX_BYTES.manifest).toBeLessThan(ADDON_MAX_BYTES.catalog)
  })
})

describe('response validation', () => {
  it('keeps well-formed previews, drops the rest and repeats, caps text', () => {
    const page = parseCatalogPage({
      metas: [
        { id: 'tt1', type: 'movie', name: '  Örnek   Film ', poster: 'javascript:alert(1)', year: 2019, imdbRating: 7.25, genres: ['Dram', 5, 'Dram'] },
        { id: 'tt1', type: 'movie', name: 'Tekrar' },
        { id: '', type: 'movie', name: 'Kimliksiz' },
        { id: 'tt2', type: 'movie', name: 'x'.repeat(1000), releaseInfo: '2020–2022', poster: 'https://img.addon.example/2.jpg', genre: 'Komedi' },
        'bozuk',
        null
      ]
    })
    expect(page?.received).toBe(6)
    expect(page?.metas.map((meta) => meta.id)).toEqual(['tt1', 'tt2'])
    expect(page?.metas[0]).toMatchObject({ name: 'Örnek Film', poster: null, year: '2019', rating: '7.25', genres: ['Dram'] })
    expect(page?.metas[1]?.name.length).toBeLessThanOrEqual(300)
    expect(page?.metas[1]).toMatchObject({ year: '2020', poster: 'https://img.addon.example/2.jpg', genres: ['Komedi'] })
    expect(parseCatalogPage({ metas: 'yok' })).toBeNull()
    expect(parseCatalogPage([])).toBeNull()
  })

  it('caps the number of previews per page', () => {
    expect(parseCatalogPage({ metas: metas('tt', 1, 800) })?.metas).toHaveLength(500)
  })

  it('reads a meta with its videos, both naming styles', () => {
    const meta = parseMeta({
      meta: {
        id: 'tt9',
        type: 'series',
        name: 'Örnek Dizi',
        cast: ['Oyuncu A', 'Oyuncu B'],
        director: 'Yönetmen C',
        runtime: '45 dk',
        videos: [
          { id: 'tt9:1:1', title: 'Başlangıç', season: 1, episode: 1, overview: 'Özet' },
          { id: 'tt9:1:2', name: 'Devam', season: '1', number: 2, description: 'Açıklama', thumbnail: 'ftp://kotu' },
          { id: 'tt9:1:2', name: 'Tekrar' },
          { title: 'Kimliksiz' }
        ]
      }
    })
    expect(meta?.cast).toEqual(['Oyuncu A', 'Oyuncu B'])
    expect(meta?.director).toEqual(['Yönetmen C'])
    expect(meta?.videos).toEqual([
      { id: 'tt9:1:1', title: 'Başlangıç', season: 1, episode: 1, released: null, thumbnail: null, overview: 'Özet' },
      { id: 'tt9:1:2', title: 'Devam', season: 1, episode: 2, released: null, thumbnail: null, overview: 'Açıklama' }
    ])
    expect(parseMeta({ meta: null })).toBeNull()
  })

  it('keeps only streams with an http(s) URL', () => {
    const streams = parseStreams({
      streams: [
        { url: STREAM_URL, name: 'A', title: 'Eski başlık', behaviorHints: { bingeGroup: 'grup-1080', filename: 'dosya.mp4', videoSize: 1234, notWebReady: true } },
        { url: 'magnet:?xt=urn:btih:abc', name: 'B' },
        { infoHash: 'abcdef', fileIdx: 1 },
        { externalUrl: 'https://baska.example/izle' },
        { ytId: 'abc' },
        { nzbUrl: 'https://nzb.example/a.nzb' },
        { url: 'https://kullanici:sifre@cdn.example/a.mp4' },
        { url: 'http://cdn.example/b.m3u8', description: 'Yeni açıklama', title: 'Eski' }
      ]
    })
    expect(streams).toEqual([
      { url: STREAM_URL, name: 'A', description: 'Eski başlık', bingeGroup: 'grup-1080', filename: 'dosya.mp4', videoSize: 1234, notWebReady: true },
      { url: 'http://cdn.example/b.m3u8', name: null, description: 'Yeni açıklama', bingeGroup: null, filename: null, videoSize: null, notWebReady: false }
    ])
    expect(parseStreams({})).toBeNull()
  })
})
