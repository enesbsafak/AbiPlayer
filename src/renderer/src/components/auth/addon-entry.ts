import { addonHost, normalizeAddonAddress, type AddonAddressProblem } from '@/addons/address'
import { fetchAddonManifest, type AddonFetchOptions } from '@/addons/client'
import { addonCapabilities, browsableCatalogs, canBeActiveSource } from '@/addons/manifest'
import { certificateAwareError } from '@/catalog/certificate-errors'
import { classifyError, toUserMessage } from '@/services/user-error'
import type { AddonManifestSummary } from '@/types/addon'
import type { PlaylistSource } from '@/types/playlist'
import { strings } from '@/strings'
import { placeError, type PlacedError } from './field-errors'

/*
 * Adding an add-on source (Stremio add-on protocol) and entering its address
 * again: the checks behind the add step's add-on form and the in-place
 * address form. The address is a secret (it can carry the add-on's settings
 * and a personal key): no message built here contains it, only the add-on's
 * name and host.
 */

const { validation, addon: text } = strings.sources

/** What the user is told about an address that is not one, beside the field. */
export function addonAddressMessage(problem: AddonAddressProblem): string {
  switch (problem) {
    case 'empty':
      return validation.emptyAddonUrl
    case 'invalid':
      return validation.invalidAddonUrl
    case 'unsupported-protocol':
      return validation.httpOnlyAddon
    case 'too-long':
      return validation.addonUrlTooLong
  }
}

/**
 * Places a failed manifest request. An add-on that refuses the address
 * (401/403) has no user name or password to blame; an address that answers
 * without a manifest is not an add-on's.
 */
export function placeAddonError(error: unknown, fallback: string): PlacedError {
  const kind = classifyError(error)
  if (kind === 'auth') return { field: 'url', message: validation.addonRefused }
  if (kind === 'bad-response') return { field: 'url', message: validation.notAnAddon }
  if (kind === 'http' && (error as { status?: unknown } | null)?.status === 404) {
    return { field: 'url', message: validation.notAnAddon }
  }
  if (kind === 'generic') return { field: null, message: toUserMessage(error, fallback) }
  return placeError(error, fallback, { address: 'url' })
}

/** What an add-on provides, as the add step and the source list describe it. */
export interface AddonOffer {
  movieCatalogs: number
  seriesCatalogs: number
  streams: boolean
  subtitles: boolean
  /** Catalogues the app does not show (other types, or needing a search or genre). */
  unusedCatalogs: number
  /** Has catalogues the app shows: can be the active source. */
  canBeActive: boolean
  /** Provides anything the app uses. */
  usable: boolean
}

export function describeAddonOffer(summary: AddonManifestSummary): AddonOffer {
  const capabilities = addonCapabilities(summary)
  const movieCatalogs = browsableCatalogs(summary, 'vod').length
  const seriesCatalogs = browsableCatalogs(summary, 'series').length
  return {
    movieCatalogs,
    seriesCatalogs,
    streams: capabilities.streams,
    subtitles: capabilities.subtitles,
    unusedCatalogs: summary.catalogs.length - movieCatalogs - seriesCatalogs,
    canBeActive: capabilities.catalogue,
    usable: capabilities.catalogue || capabilities.streams
  }
}

/** The short labels of what an add-on provides, in a fixed order. */
export function addonOfferLabels(offer: AddonOffer): string[] {
  const labels = strings.sources.manager.addonLabels
  return [
    ...(offer.movieCatalogs > 0 ? [labels.movieCatalogs] : []),
    ...(offer.seriesCatalogs > 0 ? [labels.seriesCatalogs] : []),
    ...(offer.streams ? [labels.streams] : []),
    ...(offer.subtitles ? [labels.subtitles] : [])
  ]
}

/** What an add-on provides, in plain words, for the review before it is added. */
export function addonOfferLines(offer: AddonOffer): string[] {
  return [
    ...(offer.movieCatalogs > 0 ? [text.movieCatalogs(offer.movieCatalogs)] : []),
    ...(offer.seriesCatalogs > 0 ? [text.seriesCatalogs(offer.seriesCatalogs)] : []),
    ...(offer.streams ? [text.streams] : []),
    ...(offer.subtitles ? [text.subtitles] : [])
  ]
}

/** Notes under the review: what the app does not use yet, and what else the add-on needs. */
export function addonOfferNotes(offer: AddonOffer, adult: boolean): string[] {
  return [
    ...(offer.unusedCatalogs > 0 ? [text.unusedCatalogs(offer.unusedCatalogs)] : []),
    ...(offer.subtitles ? [text.unusedSubtitles] : []),
    ...(offer.streams && !offer.canBeActive ? [text.streamOnly] : []),
    ...(offer.canBeActive && !offer.streams ? [text.catalogOnly] : []),
    ...(adult ? [text.adult] : [])
  ]
}

/** The same add-on at the same address is already a source (another address is another configuration). */
export function findInstalledAddon(
  sources: readonly PlaylistSource[],
  summary: Pick<AddonManifestSummary, 'id'>,
  base: string,
  exceptId?: string
): PlaylistSource | undefined {
  return sources.find(
    (source) => source.type === 'addon' && source.id !== exceptId && source.url === base && source.addon?.id === summary.id
  )
}

export interface CheckedAddon {
  base: string
  host: string
  summary: AddonManifestSummary
  offer: AddonOffer
}

export type AddonCheckResult = { ok: true; addon: CheckedAddon } | { ok: false; error: PlacedError }

export interface AddonCheckDeps {
  fetchManifest?: (base: string, options?: AddonFetchOptions) => Promise<AddonManifestSummary>
  /** Turns a network failure into a certificate one when main refused the host's certificate. */
  certificateAware?: (error: unknown) => Promise<unknown>
  signal?: AbortSignal
}

async function fetchChecked(base: string, deps: AddonCheckDeps): Promise<AddonManifestSummary> {
  try {
    return await (deps.fetchManifest ?? fetchAddonManifest)(base, { signal: deps.signal })
  } catch (error) {
    throw await (deps.certificateAware ?? certificateAwareError)(error)
  }
}

/**
 * Checks a typed address for the add step: normalised, its manifest fetched,
 * something the app uses in it, and not installed already.
 */
export async function checkNewAddon(
  input: string,
  sources: readonly PlaylistSource[],
  deps: AddonCheckDeps = {}
): Promise<AddonCheckResult> {
  const address = normalizeAddonAddress(input)
  if (!address.ok) return { ok: false, error: { field: 'url', message: addonAddressMessage(address.problem) } }
  const { base } = address

  let summary: AddonManifestSummary
  try {
    summary = await fetchChecked(base, deps)
  } catch (error) {
    return { ok: false, error: placeAddonError(error, text.checkFailed) }
  }

  const offer = describeAddonOffer(summary)
  if (!offer.usable) return { ok: false, error: { field: 'url', message: validation.addonUnusable(summary.name) } }
  const installed = findInstalledAddon(sources, summary, base)
  if (installed) return { ok: false, error: { field: 'url', message: validation.duplicateAddon(installed.name) } }
  return { ok: true, addon: { base, host: addonHost(base) ?? '', summary, offer } }
}

/**
 * Checks an address typed again for an existing add-on source: it must still
 * be that add-on (same manifest id, unless the stored summary was unreadable),
 * and not the address of another source with the same add-on.
 */
export async function checkAddonAddressFor(
  source: PlaylistSource,
  input: string,
  sources: readonly PlaylistSource[],
  deps: AddonCheckDeps = {}
): Promise<AddonCheckResult> {
  const address = normalizeAddonAddress(input)
  if (!address.ok) return { ok: false, error: { field: 'url', message: addonAddressMessage(address.problem) } }
  const { base } = address

  let summary: AddonManifestSummary
  try {
    summary = await fetchChecked(base, deps)
  } catch (error) {
    return { ok: false, error: placeAddonError(error, text.checkFailed) }
  }

  const knownId = source.addon?.id
  if (knownId && knownId !== 'unknown' && knownId !== summary.id) {
    return { ok: false, error: { field: 'url', message: validation.otherAddon(summary.name) } }
  }
  const installed = findInstalledAddon(sources, summary, base, source.id)
  if (installed) return { ok: false, error: { field: 'url', message: validation.duplicateAddon(installed.name) } }
  return { ok: true, addon: { base, host: addonHost(base) ?? '', summary, offer: describeAddonOffer(summary) } }
}

/**
 * A newly added add-on becomes the active source only when it can be one and
 * nothing is in use: the user's first source, or the active one is gone (only
 * stream-only add-ons so far, say).
 */
export function shouldActivateNewAddon(
  source: PlaylistSource,
  state: { sources: readonly PlaylistSource[]; activeSourceId: string | null }
): boolean {
  if (!canBeActiveSource(source)) return false
  return !state.activeSourceId || !state.sources.some((other) => other.id === state.activeSourceId)
}

/**
 * Whether the user can pick this source as the one in use. Add-ons need the
 * experimental setting on and catalogues the app shows.
 */
export function canChooseAsActive(source: PlaylistSource, addonsEnabled: boolean): boolean {
  if (source.type !== 'addon') return true
  return addonsEnabled && canBeActiveSource(source)
}

/** Why a source cannot be picked as the one in use, in one line; null when it can. */
export function notChoosableReason(source: PlaylistSource, addonsEnabled: boolean): string | null {
  if (canChooseAsActive(source, addonsEnabled)) return null
  return addonsEnabled ? strings.sources.manager.streamOnlyNotActive : strings.sources.manager.addonsOff
}

/** The new source for a checked add-on. Its name is the add-on's own. */
export function addonSourceFor(addon: CheckedAddon, now = Date.now()): PlaylistSource {
  return { id: `addon_${now}`, name: addon.summary.name, type: 'addon', url: addon.base, addon: addon.summary, addedAt: now }
}
