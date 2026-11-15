import type { SecureXtreamCredentials } from './types/electron-ipc'
import type { SecureCredentialMap } from './ipc/contract'

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

/** Keeps only well-formed entries, copying just the three credential fields. */
export function sanitizeCredentialMap(input: unknown): SecureCredentialMap {
  if (!input || typeof input !== 'object') return {}

  const result: SecureCredentialMap = {}
  for (const [sourceId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isValidSourceId(sourceId)) continue
    if (!isValidCredential(value)) continue
    result[sourceId] = { url: value.url, username: value.username, password: value.password }
  }

  return result
}
