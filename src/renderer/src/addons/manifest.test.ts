import { describe, expect, it } from 'vitest'
import {
  addonCapabilities,
  addonSupports,
  browsableCatalogs,
  canBeActiveSource,
  catalogSupportsSkip,
  sanitizeAddonManifestSummary,
  summarizeManifest
} from './manifest'
import { CATALOG_MANIFEST, STREAM_MANIFEST, catalogSource, streamSource } from './testing/fixtures'
import { defined } from '../../../shared/checked'

describe('manifest summary', () => {
  it('applies manifest-level types and id prefixes to bare resources; an entry’s own win', () => {
    const summary = defined(summarizeManifest(CATALOG_MANIFEST))
    expect(summary.resources).toEqual([
      { name: 'catalog', types: ['movie', 'series'], idPrefixes: ['tt'] },
      { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] }
    ])
    const own = defined(
      summarizeManifest({ ...STREAM_MANIFEST, idPrefixes: ['xx'], resources: ['stream', { name: 'subtitles', types: ['movie'] }] })
    )
    expect(own.resources).toEqual([
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['xx'] },
      { name: 'subtitles', types: ['movie'], idPrefixes: ['xx'] }
    ])
  })

  it('keeps no address, logo or description, only what the app needs', () => {
    const summary = summarizeManifest({ ...CATALOG_MANIFEST, logo: 'https://addon.example/logo.png', background: 'x' })
    expect(Object.keys(defined(summary)).sort()).toEqual(['adult', 'catalogs', 'id', 'name', 'resources', 'version'])
    expect(defined(summary).catalogs[0]).toEqual({
      type: 'movie',
      id: 'populer',
      name: 'Popüler Filmler',
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'genre', isRequired: false }
      ]
    })
  })

  it('reads the older extra lists and the adult flag', () => {
    const summary = defined(
      summarizeManifest({
        ...CATALOG_MANIFEST,
        behaviorHints: { adult: true },
        catalogs: [{ type: 'movie', id: 'eski', extraSupported: ['skip', 'genre'], extraRequired: ['genre'] }]
      })
    )
    expect(summary.adult).toBe(true)
    expect(summary.catalogs).toEqual([
      { type: 'movie', id: 'eski', name: 'eski', extra: [{ name: 'skip', isRequired: false }, { name: 'genre', isRequired: true }] }
    ])
  })

  it('rejects what is not a manifest and caps lists', () => {
    expect(summarizeManifest(null)).toBeNull()
    expect(summarizeManifest({ id: 'a', name: 'b' })).toBeNull()
    expect(summarizeManifest({ id: '', name: 'b', resources: [] })).toBeNull()
    const many = defined(
      summarizeManifest({ ...CATALOG_MANIFEST, catalogs: Array.from({ length: 500 }, (_, i) => ({ type: 'movie', id: `k${i}` })) })
    )
    expect(many.catalogs).toHaveLength(200)
  })

  it('reads a persisted summary back and refuses junk', () => {
    const summary = defined(summarizeManifest(CATALOG_MANIFEST))
    expect(sanitizeAddonManifestSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary)
    expect(sanitizeAddonManifestSummary({ ...summary, resources: 'x', catalogs: [{ id: 1 }] })).toEqual({
      ...summary,
      resources: [],
      catalogs: []
    })
    expect(sanitizeAddonManifestSummary('bozuk')).toBeNull()
  })
})

describe('what an add-on can do', () => {
  const catalogue = defined(summarizeManifest(CATALOG_MANIFEST))
  const streams = defined(summarizeManifest(STREAM_MANIFEST))

  it('matches resources by type and id prefix', () => {
    expect(addonSupports(streams, 'stream', 'movie', 'tt0000001')).toBe(true)
    expect(addonSupports(streams, 'stream', 'movie', 'yt:abc')).toBe(false)
    expect(addonSupports(streams, 'stream', 'tv', 'tt0000001')).toBe(false)
    expect(addonSupports(catalogue, 'stream', 'movie', 'tt0000001')).toBe(false)
    const anyId = defined(summarizeManifest({ ...STREAM_MANIFEST, resources: ['stream'] }))
    expect(addonSupports(anyId, 'stream', 'series', 'ornek:1')).toBe(true)
  })

  it('shows film and series catalogues that need no extra the app does not send', () => {
    expect(browsableCatalogs(catalogue).map((entry) => entry.id)).toEqual(['populer', 'yeni'])
    expect(browsableCatalogs(catalogue, 'series').map((entry) => entry.id)).toEqual(['yeni'])
    expect(catalogSupportsSkip(defined(catalogue.catalogs[0]))).toBe(true)
  })

  it('derives the capabilities and which add-on can be active', () => {
    expect(addonCapabilities(catalogue)).toEqual({ catalogue: true, streams: false, subtitles: false })
    expect(addonCapabilities(streams)).toEqual({ catalogue: false, streams: true, subtitles: false })
    expect(canBeActiveSource(catalogSource())).toBe(true)
    expect(canBeActiveSource(streamSource())).toBe(false)
    expect(canBeActiveSource({ id: 'x', name: 'Panel', type: 'xtream', addedAt: 1 })).toBe(true)
  })
})
