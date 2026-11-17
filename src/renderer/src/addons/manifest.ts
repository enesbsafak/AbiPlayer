import type { CatalogType } from '@/catalog/types'
import type {
  AddonCatalogExtraSummary,
  AddonCatalogSummary,
  AddonManifestSummary,
  AddonResourceSummary
} from '@/types/addon'
import type { PlaylistSource } from '@/types/playlist'
import type { AddonContentType } from '../../../shared/playback'
import { sources } from '@/strings/sources'
import { isRecord, readArray, readId, readText } from './validate'

/*
 * The manifest of an add-on (Stremio add-on protocol) and what the app keeps
 * of it: `AddonManifestSummary`, persisted with the source. Everything the app
 * asks of an add-on (does it list films, can it give streams for this id) is
 * answered from that summary.
 */

const MAX_NAME_LENGTH = 120
const MAX_ID_LENGTH = 256
const MAX_TOKEN_LENGTH = 64
const MAX_RESOURCES = 32
const MAX_TYPES = 32
const MAX_ID_PREFIXES = 64
const MAX_CATALOGS = 200
const MAX_EXTRAS = 16

/** The add-on content types the app shows, and the catalog partition each goes to. */
export const ADDON_CONTENT_TYPES: Readonly<Record<AddonContentType, CatalogType>> = { movie: 'vod', series: 'series' }

export function addonContentTypeOf(type: CatalogType): AddonContentType | null {
  if (type === 'vod') return 'movie'
  if (type === 'series') return 'series'
  return null
}

export function catalogTypeOfAddon(type: string): CatalogType | null {
  return type === 'movie' || type === 'series' ? ADDON_CONTENT_TYPES[type] : null
}

function readTokens(value: unknown, max: number): string[] {
  const list: string[] = []
  for (const item of readArray(value, max * 4)) {
    if (list.length >= max) break
    const token = readId(item, MAX_TOKEN_LENGTH)
    if (token && !list.includes(token)) list.push(token)
  }
  return list
}

function readExtras(entry: Record<string, unknown>): AddonCatalogExtraSummary[] {
  const extras: AddonCatalogExtraSummary[] = []
  const add = (name: string | null, isRequired: boolean) => {
    if (!name || extras.length >= MAX_EXTRAS) return
    const known = extras.find((extra) => extra.name === name)
    if (known) known.isRequired ||= isRequired
    else extras.push({ name, isRequired })
  }
  for (const raw of readArray(entry.extra, MAX_EXTRAS * 4)) {
    if (isRecord(raw)) add(readId(raw.name, MAX_TOKEN_LENGTH), raw.isRequired === true)
  }
  // The older form: two lists of names.
  const required = readTokens(entry.extraRequired, MAX_EXTRAS)
  for (const name of readTokens(entry.extraSupported, MAX_EXTRAS)) add(name, required.includes(name))
  for (const name of required) add(name, true)
  return extras
}

function readCatalog(raw: unknown): AddonCatalogSummary | null {
  if (!isRecord(raw)) return null
  const type = readId(raw.type, MAX_TOKEN_LENGTH)
  const id = readId(raw.id, MAX_ID_LENGTH)
  if (!type || !id) return null
  return { type, id, name: readText(raw.name, MAX_NAME_LENGTH) ?? id, extra: readExtras(raw) }
}

function readCatalogs(value: unknown): AddonCatalogSummary[] {
  const catalogs: AddonCatalogSummary[] = []
  for (const raw of readArray(value, MAX_CATALOGS * 2)) {
    if (catalogs.length >= MAX_CATALOGS) break
    const catalog = readCatalog(raw)
    // A (type, id) pair is one catalogue; a repeat would be the same requests.
    if (catalog && !catalogs.some((other) => other.type === catalog.type && other.id === catalog.id)) catalogs.push(catalog)
  }
  return catalogs
}

/**
 * The summary of a manifest the add-on sent, or null when it is not one. A
 * resource may be a bare name or an object; its own `types` and `idPrefixes`
 * win over the manifest's.
 */
export function summarizeManifest(data: unknown): AddonManifestSummary | null {
  if (!isRecord(data)) return null
  const id = readId(data.id, MAX_ID_LENGTH)
  const name = readText(data.name, MAX_NAME_LENGTH)
  if (!id || !name || !Array.isArray(data.resources)) return null

  const types = readTokens(data.types, MAX_TYPES)
  const idPrefixes = Array.isArray(data.idPrefixes) ? readTokens(data.idPrefixes, MAX_ID_PREFIXES) : null
  const resources: AddonResourceSummary[] = []
  for (const raw of readArray(data.resources, MAX_RESOURCES * 2)) {
    if (resources.length >= MAX_RESOURCES) break
    if (typeof raw === 'string') {
      const resourceName = readId(raw, MAX_TOKEN_LENGTH)
      if (resourceName) resources.push({ name: resourceName, types: [...types], idPrefixes: idPrefixes && [...idPrefixes] })
      continue
    }
    if (!isRecord(raw)) continue
    const resourceName = readId(raw.name, MAX_TOKEN_LENGTH)
    if (!resourceName) continue
    resources.push({
      name: resourceName,
      types: Array.isArray(raw.types) ? readTokens(raw.types, MAX_TYPES) : [...types],
      idPrefixes: Array.isArray(raw.idPrefixes) ? readTokens(raw.idPrefixes, MAX_ID_PREFIXES) : idPrefixes && [...idPrefixes]
    })
  }

  return {
    id,
    name,
    version: readText(data.version, MAX_TOKEN_LENGTH) ?? '',
    resources,
    catalogs: readCatalogs(data.catalogs),
    adult: isRecord(data.behaviorHints) && data.behaviorHints.adult === true
  }
}

/** A persisted summary read back (unknown data), or null when it is not one. */
export function sanitizeAddonManifestSummary(raw: unknown): AddonManifestSummary | null {
  if (!isRecord(raw)) return null
  const id = readId(raw.id, MAX_ID_LENGTH)
  const name = readText(raw.name, MAX_NAME_LENGTH)
  if (!id || !name) return null
  const resources: AddonResourceSummary[] = []
  for (const entry of readArray(raw.resources, MAX_RESOURCES)) {
    if (!isRecord(entry)) continue
    const resourceName = readId(entry.name, MAX_TOKEN_LENGTH)
    if (!resourceName) continue
    resources.push({
      name: resourceName,
      types: readTokens(entry.types, MAX_TYPES),
      idPrefixes: Array.isArray(entry.idPrefixes) ? readTokens(entry.idPrefixes, MAX_ID_PREFIXES) : null
    })
  }
  return {
    id,
    name,
    version: readText(raw.version, MAX_TOKEN_LENGTH) ?? '',
    resources,
    catalogs: readCatalogs(raw.catalogs),
    adult: raw.adult === true
  }
}

/** A summary with nothing in it, for an `addon` source whose stored summary is unreadable (the next connection refreshes it). */
export function emptyAddonManifestSummary(name: string): AddonManifestSummary {
  const fallback = readText(name, MAX_NAME_LENGTH) ?? sources.typeLabels.addon
  return { id: 'unknown', name: fallback, version: '', resources: [], catalogs: [], adult: false }
}

/**
 * Whether the add-on offers `resource` for `type` (and, when given, the id
 * `id`): a resource of that name whose types include it and whose id
 * prefixes, if it lists any, match.
 */
export function addonSupports(summary: AddonManifestSummary, resource: string, type: string, id?: string): boolean {
  return summary.resources.some(
    (entry) =>
      entry.name === resource &&
      entry.types.includes(type) &&
      (id === undefined || entry.idPrefixes === null || entry.idPrefixes.some((prefix) => id.startsWith(prefix)))
  )
}

/** The extra properties the app can send to a catalogue: only `skip` (search and genre filters are not offered). */
const SENDABLE_EXTRAS: ReadonlySet<string> = new Set(['skip'])

/**
 * A catalogue the app shows: films or series, openable without an extra
 * property the app does not send (a required genre or search).
 */
export function isBrowsableCatalog(catalog: AddonCatalogSummary): boolean {
  if (catalogTypeOfAddon(catalog.type) === null) return false
  return catalog.extra.every((extra) => !extra.isRequired || SENDABLE_EXTRAS.has(extra.name))
}

/** The catalogue pages through `skip`; without it only the first page exists. */
export function catalogSupportsSkip(catalog: AddonCatalogSummary): boolean {
  return catalog.extra.some((extra) => extra.name === 'skip')
}

/** The catalogues shown on the Filmler (`vod`) or Diziler (`series`) page, in the add-on's order. */
export function browsableCatalogs(summary: AddonManifestSummary, type?: CatalogType): AddonCatalogSummary[] {
  return summary.catalogs.filter(
    (catalog) => isBrowsableCatalog(catalog) && (type === undefined || catalogTypeOfAddon(catalog.type) === type)
  )
}

/** Extra properties a search request can send besides the query. */
const SEARCH_EXTRAS: ReadonlySet<string> = new Set(['search', 'skip'])

/**
 * The catalogue a page's search box asks for `type` (`vod` or `series`): the
 * first of that type that declares the `search` extra and needs nothing else
 * the app does not send. Null when the add-on cannot search that type.
 */
export function searchCatalogFor(summary: AddonManifestSummary, type: CatalogType): AddonCatalogSummary | null {
  return (
    summary.catalogs.find(
      (catalog) =>
        catalogTypeOfAddon(catalog.type) === type &&
        catalog.extra.some((extra) => extra.name === 'search') &&
        catalog.extra.every((extra) => !extra.isRequired || SEARCH_EXTRAS.has(extra.name))
    ) ?? null
  )
}

export interface AddonCapabilities {
  /** Has film or series catalogues the app shows: can be the active source. */
  catalogue: boolean
  /** Answers stream requests for films or series. */
  streams: boolean
  /** Has a subtitles resource (not used yet). */
  subtitles: boolean
}

export function addonCapabilities(summary: AddonManifestSummary): AddonCapabilities {
  const forShownTypes = (name: string) =>
    summary.resources.some((entry) => entry.name === name && (entry.types.includes('movie') || entry.types.includes('series')))
  return {
    catalogue: browsableCatalogs(summary).length > 0,
    streams: forShownTypes('stream'),
    subtitles: summary.resources.some((entry) => entry.name === 'subtitles')
  }
}

/**
 * Whether a source can be the active one (whose catalogue the pages show).
 * Every Xtream and M3U source can; an add-on only with catalogues the app
 * shows. Stream-only add-ons are never active, only asked for streams.
 */
export function canBeActiveSource(source: PlaylistSource): boolean {
  if (source.type !== 'addon') return true
  return !!source.addon && addonCapabilities(source.addon).catalogue
}
