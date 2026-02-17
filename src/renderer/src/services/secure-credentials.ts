import type { XtreamCredentials } from '@/types/xtream'

type CredentialMap = Record<string, XtreamCredentials>

function isValidCredential(value: unknown): value is XtreamCredentials {
  if (!value || typeof value !== 'object') return false
  const cred = value as XtreamCredentials
  return (
    typeof cred.url === 'string' &&
    /^https?:\/\//i.test(cred.url) &&
    typeof cred.username === 'string' &&
    cred.username.length > 0 &&
    typeof cred.password === 'string' &&
    cred.password.length > 0
  )
}

function sanitizeCredentialMap(input: unknown): CredentialMap {
  if (!input || typeof input !== 'object') return {}
  const result: CredentialMap = {}

  for (const [sourceId, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof sourceId !== 'string' || sourceId.length === 0) continue
    if (!isValidCredential(value)) continue
    result[sourceId] = value
  }

  return result
}

export const secureCredentialService = {
  async getAll(): Promise<CredentialMap> {
    if (!window.electron?.getSecureCredentials) return {}
    const raw = await window.electron.getSecureCredentials()
    return sanitizeCredentialMap(raw)
  },

  async set(sourceId: string, credential: XtreamCredentials): Promise<void> {
    if (!window.electron?.setSecureCredential) return
    await window.electron.setSecureCredential(sourceId, credential)
  },

  async delete(sourceId: string): Promise<void> {
    if (!window.electron?.deleteSecureCredential) return
    await window.electron.deleteSecureCredential(sourceId)
  }
}
