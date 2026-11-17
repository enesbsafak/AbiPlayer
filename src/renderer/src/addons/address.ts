import { MAX_SECURE_ADDON_URL_LENGTH } from '../../../shared/secure-credentials'

/*
 * An add-on's address (Stremio add-on protocol). Users paste the manifest
 * link, often as `stremio://…/manifest.json`; what is kept is the base the
 * resources hang off: `https://host/path` without `/manifest.json`, query or
 * fragment. The base can carry the add-on's settings, a personal key among
 * them, so it is a secret: it goes to the secure store and never into a
 * message, a log or the UI. `addonHost` is the part that may be shown.
 */

export type AddonAddressProblem = 'empty' | 'invalid' | 'unsupported-protocol' | 'too-long'

export type AddonAddressResult = { ok: true; base: string } | { ok: false; problem: AddonAddressProblem }

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * The base address of a pasted add-on link, or why it is not one. A link
 * without a scheme is read as https; `stremio://` is https as well. Only
 * http and https are accepted, without a user name or password in them.
 */
export function normalizeAddonAddress(input: string): AddonAddressResult {
  let text = input.trim()
  if (!text) return { ok: false, problem: 'empty' }
  if (/^stremio:\/\//i.test(text)) text = `https://${text.slice('stremio://'.length)}`
  else if (!HAS_SCHEME.test(text)) text = `https://${text}`

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, problem: 'invalid' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, problem: 'unsupported-protocol' }
  if (!url.hostname || url.username || url.password) return { ok: false, problem: 'invalid' }

  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(/\/manifest\.json$/i, '').replace(/\/+$/, '')
  const base = `${url.protocol}//${url.host}${path}`
  if (/\s/.test(base)) return { ok: false, problem: 'invalid' }
  if (base.length > MAX_SECURE_ADDON_URL_LENGTH) return { ok: false, problem: 'too-long' }
  return { ok: true, base }
}

/** The host of a base address as it may be shown (no path: that is where the settings are). */
export function addonHost(base: string | null | undefined): string | null {
  if (!base) return null
  try {
    return new URL(base).host || null
  } catch {
    return null
  }
}

export function addonManifestUrl(base: string): string {
  return `${base}/manifest.json`
}

/**
 * `{base}/{resource}/{type}/{id}.json`, or with extra properties
 * `{base}/{resource}/{type}/{id}/{key=value&key=value}.json`; every part is
 * URL-encoded, so an id like `tt1234567:1:2` stays one segment.
 */
export function addonResourceUrl(
  base: string,
  resource: string,
  type: string,
  id: string,
  extra: ReadonlyArray<readonly [string, string | number]> = []
): string {
  const head = `${base}/${encodeURIComponent(resource)}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`
  if (extra.length === 0) return `${head}.json`
  const segment = extra.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')
  return `${head}/${segment}.json`
}
