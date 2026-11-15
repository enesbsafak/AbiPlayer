import type { SecureXtreamCredentials } from './types/electron-ipc'
import type { SecureCredentialMap, SecureM3uSourceSecret, SecureSourceSecret } from './ipc/contract'

/** Longest M3U URL the store accepts; real ones are a few hundred characters. */
export const MAX_SECURE_M3U_URL_LENGTH = 8192

export function isValidSourceId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256
}

export function isValidCredential(value: unknown): value is SecureXtreamCredentials {
  if (!value || typeof value !== 'object') return false
  const cred = value as SecureXtreamCredentials
  return (
    typeof cred.url === 'string' &&
    /^https?:\/\//i.test(cred.url) &&
    typeof cred.username === 'string' &&
    cred.username.length > 0 &&
    typeof cred.password === 'string' &&
    cred.password.length > 0
  )
}

/** An http(s) URL without whitespace, as `new URL(...).toString()` produces it. */
export function isValidM3uSecret(value: unknown): value is SecureM3uSourceSecret {
  if (!value || typeof value !== 'object') return false
  const secret = value as SecureM3uSourceSecret
  return (
    secret.kind === 'm3u_url' &&
    typeof secret.url === 'string' &&
    secret.url.length <= MAX_SECURE_M3U_URL_LENGTH &&
    /^https?:\/\/\S+$/i.test(secret.url)
  )
}

/** Longest TMDB key the store accepts (v4 read tokens are a few hundred characters). */
export const MAX_SECURE_TMDB_API_KEY_LENGTH = 512

/** A TMDB v3 API key (hex) or v4 read token (a JWT): printable, no whitespace. */
export function isValidTmdbApiKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SECURE_TMDB_API_KEY_LENGTH &&
    /^[A-Za-z0-9._~+/=-]+$/.test(value)
  )
}

export function isM3uSecret(value: SecureSourceSecret): value is SecureM3uSourceSecret {
  return (value as SecureM3uSourceSecret).kind === 'm3u_url'
}

/**
 * Either shape, checked strictly. An object that says it is an M3U secret is
 * judged only as one, so a malformed one never passes as Xtream credentials.
 */
export function isValidSourceSecret(value: unknown): value is SecureSourceSecret {
  if (value && typeof value === 'object' && 'kind' in value) return isValidM3uSecret(value)
  return isValidCredential(value)
}

/** A copy holding only the fields of its shape. */
export function copySourceSecret(value: SecureSourceSecret): SecureSourceSecret {
  if (isM3uSecret(value)) return { kind: 'm3u_url', url: value.url }
  return { url: value.url, username: value.username, password: value.password }
}

/** Keeps only well-formed entries, copying just the fields of each shape. */
export function sanitizeCredentialMap(input: unknown): SecureCredentialMap {
  if (!input || typeof input !== 'object') return {}

  const result: SecureCredentialMap = {}
  for (const [sourceId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isValidSourceId(sourceId)) continue
    if (!isValidSourceSecret(value)) continue
    result[sourceId] = copySourceSecret(value)
  }

  return result
}
