import type { AddonCatalogSummary } from '@/types/addon'
import type { PlaylistSource } from '@/types/playlist'
import type { AddonContentType } from '../../../shared/playback'
import { isTmdbCatalogSource } from './builtin'
import {
  fetchAddonCatalogPage,
  fetchAddonMeta,
  type AddonCatalogPage,
  type AddonFetchOptions,
  type AddonMeta,
  type AddonVideo
} from './client'
import { addonSupports } from './manifest'
import { fetchTmdbCatalogPage, fetchTmdbMeta, fetchTmdbSeason, type TmdbDeps } from './tmdb'

/*
 * Where a catalogue source's pages and metas come from. An add-on answers
 * them at its address (client.ts); the built-in TMDB catalogue asks TMDB
 * with the user's key (tmdb.ts). Everything above this (the pager, the
 * detail views, the search box) asks the provider and does not care which.
 */

export interface AddonCatalogPageRequest {
  /** Entries received before: 0 for the first page. */
  skip: number
  /** A search catalogue's query. */
  search?: string
}

export interface AddonCatalogProvider {
  /** One page of a catalogue of the source's summary. */
  catalogPage(catalog: AddonCatalogSummary, request: AddonCatalogPageRequest, options: AddonFetchOptions): Promise<AddonCatalogPage>
  /** The meta of a film or series, or null when the source has none for it (the page shows what the card knows). */
  meta(type: AddonContentType, metaId: string, options: AddonFetchOptions): Promise<AddonMeta | null>
  /** The episodes of one season, for a meta that lists its `seasons` without them. */
  seasonVideos(meta: AddonMeta, season: number, options: AddonFetchOptions): Promise<AddonVideo[]>
}

export interface RemoteProviderDeps {
  fetchPage?: (
    base: string,
    catalog: AddonCatalogSummary,
    skip: number,
    options: AddonFetchOptions,
    search?: string
  ) => Promise<AddonCatalogPage>
  fetchMeta?: typeof fetchAddonMeta
}

/** An add-on's provider: its address and its summary, or null while its address is not in memory. */
export function remoteCatalogProvider(source: PlaylistSource, deps: RemoteProviderDeps = {}): AddonCatalogProvider | null {
  const base = source.url
  const summary = source.addon
  if (source.type !== 'addon' || isTmdbCatalogSource(source) || !base || !summary) return null
  const fetchPage = deps.fetchPage ?? fetchAddonCatalogPage
  const fetchMeta = deps.fetchMeta ?? fetchAddonMeta
  return {
    catalogPage: (catalog, request, options) =>
      request.search === undefined ? fetchPage(base, catalog, request.skip, options) : fetchPage(base, catalog, request.skip, options, request.search),
    async meta(type, metaId, options) {
      if (!addonSupports(summary, 'meta', type, metaId)) return null
      return fetchMeta(base, type, metaId, options)
    },
    // An add-on's series meta lists every episode in `videos`.
    seasonVideos: async () => []
  }
}

/** The TMDB catalogue's provider for a key. */
export function tmdbCatalogProvider(apiKey: string, deps: TmdbDeps = {}): AddonCatalogProvider {
  return {
    catalogPage: (catalog, request, options) =>
      fetchTmdbCatalogPage(apiKey, catalog, request.skip, { ...deps, signal: options.signal, search: request.search }),
    meta: (type, metaId, options) => fetchTmdbMeta(apiKey, type, metaId, { ...deps, signal: options.signal }),
    seasonVideos: (meta, season, options) => fetchTmdbSeason(apiKey, meta, season, { ...deps, signal: options.signal })
  }
}

export interface ProviderContext {
  /** The TMDB key saved in Ayarlar, or null. */
  tmdbApiKey: string | null
}

/**
 * The provider of a catalogue source, or null when it cannot ask anything
 * now: an add-on whose address is not loaded, the TMDB catalogue without a
 * key, a source that is no catalogue source.
 */
export function catalogProviderFor(source: PlaylistSource | null | undefined, context: ProviderContext): AddonCatalogProvider | null {
  if (!source || source.type !== 'addon') return null
  if (isTmdbCatalogSource(source)) return context.tmdbApiKey ? tmdbCatalogProvider(context.tmdbApiKey) : null
  return remoteCatalogProvider(source)
}
