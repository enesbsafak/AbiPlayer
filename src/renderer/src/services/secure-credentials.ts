import type { XtreamCredentials } from '@/types/xtream'
import type { SecureCredentialsLossNotice } from '../../../shared/ipc/contract'
import { sanitizeCredentialMap } from '../../../shared/secure-credentials'

export type { SecureCredentialsLossNotice }

type CredentialMap = Record<string, XtreamCredentials>

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
  },

  /**
   * Non-null when main found the encrypted credential file unreadable during
   * this run and moved it aside: every stored password is gone and the user
   * must log in to those sources again.
   */
  async getLossNotice(): Promise<SecureCredentialsLossNotice | null> {
    if (!window.electron?.getSecureCredentialsLoss) return null
    return window.electron.getSecureCredentialsLoss()
  },

  /** Same notice, pushed the moment it happens. Returns an unsubscribe function. */
  onLost(listener: (notice: SecureCredentialsLossNotice) => void): () => void {
    if (!window.electron?.onSecureCredentialsLost) return () => undefined
    return window.electron.onSecureCredentialsLost(listener)
  }
}
