/**
 * What the app keeps of an add-on's manifest (Stremio add-on protocol): the
 * non-secret summary persisted with an `addon` source. The add-on's address is
 * not part of it; it lives in the secure store like an M3U URL. What the
 * add-on can do (catalogue, streams, subtitles) is derived from this summary.
 */

/** One entry of `resources`, with the manifest-level types and id prefixes already applied where the entry has none. */
export interface AddonResourceSummary {
  /** `catalog`, `meta`, `stream`, `subtitles`, ... */
  name: string
  types: string[]
  /** Null: every id is accepted. */
  idPrefixes: string[] | null
}

export interface AddonCatalogExtraSummary {
  name: string
  isRequired: boolean
}

export interface AddonCatalogSummary {
  /** The add-on's content type (`movie`, `series`, `tv`, ...). */
  type: string
  id: string
  name: string
  extra: AddonCatalogExtraSummary[]
}

export interface AddonManifestSummary {
  id: string
  name: string
  version: string
  resources: AddonResourceSummary[]
  catalogs: AddonCatalogSummary[]
  /** `behaviorHints.adult`: everything the add-on lists counts as adult content. */
  adult: boolean
}
