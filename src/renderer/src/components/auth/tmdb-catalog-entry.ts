import { useStore } from '@/store'
import { isTmdbCatalogSource, tmdbCatalogSourceFor } from '@/addons/builtin'
import { commitAddonCategories } from '@/addons/catalog'
import { addonErrorMessage } from '@/addons/messages'
import { fetchTmdbCatalogSummary } from '@/addons/connect'
import type { AddonManifestSummary } from '@/types/addon'
import type { PlaylistSource } from '@/types/playlist'
import { resolveTmdbApiKey } from '@/services/tmdb-api'
import { strings } from '@/strings'
import { shouldActivateNewAddon } from './addon-entry'

/*
 * Adding the built-in TMDB catalogue (Ayarlar → Kaynaklar → Deneysel). It
 * has no address to check: the TMDB key saved under Genel is checked by
 * asking TMDB for its genres, which also gives the genre catalogues. Like a
 * new add-on, it becomes the source in use only when nothing is in use yet.
 */

/** Where the add action stands: no key yet, ready, or already a source. */
export type TmdbCatalogEntryState = 'needs-key' | 'ready' | 'added'

export function tmdbCatalogEntryState(sources: readonly PlaylistSource[], tmdbApiKey: string | null | undefined): TmdbCatalogEntryState {
  if (sources.some((source) => isTmdbCatalogSource(source))) return 'added'
  return resolveTmdbApiKey(tmdbApiKey) ? 'ready' : 'needs-key'
}

export type TmdbCatalogAddResult =
  | { ok: true; source: PlaylistSource; activated: boolean }
  | { ok: false; message: string }

export interface TmdbCatalogAddDeps {
  /** Builds the summary with TMDB's genres (tests replace the network). */
  fetchSummary?: (apiKey: string) => Promise<AddonManifestSummary>
  now?: number
}

/** Checks the key with TMDB and adds the catalogue as a source; never rejects. */
export async function addTmdbCatalog(deps: TmdbCatalogAddDeps = {}): Promise<TmdbCatalogAddResult> {
  const before = useStore.getState()
  const apiKey = resolveTmdbApiKey(before.settings.tmdbApiKey)
  if (!apiKey) return { ok: false, message: strings.errors.tmdb.noKey }
  if (before.sources.some((source) => isTmdbCatalogSource(source))) {
    return { ok: false, message: strings.sources.tmdbCatalog.addFailed }
  }

  let summary: AddonManifestSummary
  try {
    summary = await (deps.fetchSummary ?? ((key: string) => fetchTmdbCatalogSummary(key)))(apiKey)
  } catch (error) {
    // TMDB's own sentence (a refused key, too many requests, offline); never the key.
    return { ok: false, message: addonErrorMessage(error, strings.sources.tmdbCatalog.addFailed) }
  }

  const state = useStore.getState()
  // Added meanwhile (a double click): the one there stays.
  const existing = state.sources.find((source) => isTmdbCatalogSource(source))
  if (existing) return { ok: true, source: existing, activated: false }
  const source = tmdbCatalogSourceFor(summary, deps.now)
  const activate = shouldActivateNewAddon(source, state)
  // Its catalogues were just built: recorded as connected before it is
  // added, so the start-up connection does not ask TMDB again.
  state.setAddonSession(source.id, { manifestFresh: true })
  state.addSource(source)
  commitAddonCategories(source)
  if (activate) state.setActiveSource(source.id)
  return { ok: true, source, activated: activate }
}
