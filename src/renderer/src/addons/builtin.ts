import type { AddonManifestSummary } from '@/types/addon'
import type { BuiltinCatalogId, PlaylistSource } from '@/types/playlist'
import { strings } from '@/strings'

/*
 * Built-in catalogues: `addon` sources the app provides itself, marked with
 * `builtin`. Today there is one, the TMDB catalogue (tmdb.ts), asked with
 * the TMDB key the user keeps in Ayarlar → Genel. It is modelled as an
 * add-on source so everything built for catalogue add-ons applies as it is:
 * its catalogues are categories (catalog.ts), its pages come through the
 * pager, its items and details map onto the same shapes, its films and
 * episodes are `addon` playback targets whose streams any stream add-on
 * gives. What differs is behind the catalogue provider (provider.ts): no
 * address, nothing in the secure store, requests to TMDB instead of an
 * add-on.
 */

/** The one TMDB catalogue's source id: a fixed id, so it is added at most once and its history survives removing and adding it again. */
export const TMDB_CATALOG_SOURCE_ID = 'builtin_tmdb'

export function isTmdbCatalogSource(source: Pick<PlaylistSource, 'type' | 'builtin'> | null | undefined): boolean {
  return source?.type === 'addon' && source.builtin === 'tmdb'
}

/** A stored `builtin` value read back (unknown data): a known id, or undefined. */
export function sanitizeBuiltinCatalogId(value: unknown): BuiltinCatalogId | undefined {
  return value === 'tmdb' ? value : undefined
}

/** The TMDB catalogue as a new source, with the summary built for it. */
export function tmdbCatalogSourceFor(summary: AddonManifestSummary, now = Date.now()): PlaylistSource {
  return {
    id: TMDB_CATALOG_SOURCE_ID,
    name: strings.sources.tmdbCatalog.name,
    type: 'addon',
    builtin: 'tmdb',
    addon: summary,
    addedAt: now
  }
}

/**
 * Whether a catalogue source can ask for pages now: an add-on once its
 * address is in memory, the TMDB catalogue while a TMDB key is saved.
 */
export function catalogSourceReady(source: PlaylistSource | null | undefined, tmdbApiKey: string | null): boolean {
  if (!source || source.type !== 'addon') return false
  if (isTmdbCatalogSource(source)) return !!tmdbApiKey
  return !!source.url
}
