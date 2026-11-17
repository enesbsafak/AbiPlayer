import { catalog as defaultCatalog, type CatalogStore } from '@/catalog/catalog-store'
import { certificateAwareError } from '@/catalog/certificate-errors'
import { toUserMessage } from '@/services/user-error'
import type { AddonManifestSummary } from '@/types/addon'
import type { PlaylistSource } from '@/types/playlist'
import { commitAddonCategories } from './catalog'
import { fetchAddonManifest, type AddonFetchOptions } from './client'

/*
 * Connecting an `addon` source: its address is in memory (from the secure
 * store), its manifest is fetched again when the add-on can be reached and
 * the stored summary replaced, and its film and series catalogues are put in
 * the catalog store as categories. An add-on that cannot be reached is not a
 * failed source: the stored summary stands in for the manifest, and the
 * catalogue and stream requests fail on their own if the add-on stays away.
 */

/** Session state of a connected add-on: whether its manifest was refreshed in this session. */
export interface AddonSession {
  manifestFresh: boolean
}

export interface AddonConnectDeps {
  fetchManifest?: (base: string, options: AddonFetchOptions) => Promise<AddonManifestSummary>
  /** Stores the refreshed summary on the source. */
  updateSummary: (sourceId: string, summary: AddonManifestSummary) => void
  store?: CatalogStore
  signal?: AbortSignal
}

export interface AddonRefreshOutcome {
  /** The source with the summary now in use. */
  source: PlaylistSource
  session: AddonSession
}

function sameSummary(a: AddonManifestSummary | undefined, b: AddonManifestSummary): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Refreshes the manifest of an `addon` source whose address is loaded and
 * puts its catalogues in the store. With `strict`, a manifest that cannot be
 * fetched rejects (a reload the user asked for); otherwise the stored summary
 * is used and the outcome says the manifest is not fresh.
 */
export async function refreshAddonSource(
  source: PlaylistSource,
  deps: AddonConnectDeps,
  options: { strict?: boolean } = {}
): Promise<AddonRefreshOutcome> {
  if (source.type !== 'addon' || !source.url) throw new Error('refreshAddonSource: not an add-on with an address')
  let current = source
  let manifestFresh = false
  try {
    const summary = await (deps.fetchManifest ?? fetchAddonManifest)(source.url, { signal: deps.signal })
    manifestFresh = true
    if (!sameSummary(source.addon, summary)) {
      deps.updateSummary(source.id, summary)
      current = { ...source, addon: summary }
    }
  } catch (error) {
    if (options.strict) throw await certificateAwareError(error)
    // Offline, or the add-on is down: the stored summary will do. The
    // message holds no address (see addons/request.ts).
    console.warn('[addon] manifest not refreshed:', toUserMessage(error))
  }
  commitAddonCategories(current, deps.store ?? defaultCatalog)
  return { source: current, session: { manifestFresh } }
}
