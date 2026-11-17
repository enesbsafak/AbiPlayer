import type { PlaylistSource } from '@/types/playlist'
import { summarizeManifest } from '../manifest'
import { defined } from '../../../../shared/checked'

/*
 * Invented add-ons for the unit tests. The base addresses carry a fake
 * settings segment so the tests can check it never leaks.
 */

export const SECRET_SEGMENT = 'ayar-gizli-0123456789abcdef'
export const CATALOG_BASE = `https://addon.example/${SECRET_SEGMENT}`
export const STREAM_BASE = `https://akis.addon.example/${SECRET_SEGMENT}-akis`
export const STREAM_URL = `${STREAM_BASE}/oynat/tt0000001/dosya.mp4`

export const CATALOG_MANIFEST = {
  id: 'org.ornek.katalog',
  name: 'Örnek Katalog',
  version: '1.2.0',
  description: 'Uydurma bir katalog eklentisi',
  resources: ['catalog', { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] }],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [
    { type: 'movie', id: 'populer', name: 'Popüler Filmler', extra: [{ name: 'skip' }, { name: 'genre', options: ['Dram'] }] },
    { type: 'series', id: 'yeni', name: 'Yeni Diziler', extra: [{ name: 'skip' }] },
    { type: 'movie', id: 'ara', name: 'Arama', extra: [{ name: 'search', isRequired: true }] },
    { type: 'tv', id: 'kanallar', name: 'Kanallar' }
  ],
  behaviorHints: { configurable: true }
}

export const STREAM_MANIFEST = {
  id: 'org.ornek.akis',
  name: 'Örnek Akış',
  version: '0.1.0',
  resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
  types: ['movie', 'series'],
  catalogs: []
}

export function catalogSource(overrides: Partial<PlaylistSource> = {}): PlaylistSource {
  return {
    id: 'ek',
    name: 'Örnek Katalog',
    type: 'addon',
    url: CATALOG_BASE,
    addon: defined(summarizeManifest(CATALOG_MANIFEST)),
    addedAt: 1,
    ...overrides
  }
}

export function streamSource(overrides: Partial<PlaylistSource> = {}): PlaylistSource {
  return {
    id: 'ak',
    name: 'Örnek Akış',
    type: 'addon',
    url: STREAM_BASE,
    addon: defined(summarizeManifest(STREAM_MANIFEST)),
    addedAt: 2,
    ...overrides
  }
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

/** A `fetch` answering by URL; anything unknown is a 404. Records what was asked. */
export function routeFetch(routes: Record<string, () => Response | Promise<Response>>): typeof fetch & { calls: string[] } {
  const calls: string[] = []
  const impl = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    const route = routes[url]
    return route ? route() : new Response('yok', { status: 404 })
  }) as typeof fetch & { calls: string[] }
  impl.calls = calls
  return impl
}

/** `n` meta previews with ids `prefix1` ... */
export function metas(prefix: string, from: number, count: number, type = 'movie'): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${from + index}`,
    type,
    name: `Örnek ${from + index}`,
    poster: `https://img.addon.example/${from + index}.jpg`,
    releaseInfo: '2021',
    imdbRating: '7.1'
  }))
}
