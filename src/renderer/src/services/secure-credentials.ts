import type { XtreamCredentials } from '@/types/xtream'
import type { SecureCredentialMap, SecureCredentialsLossNotice } from '../../../shared/ipc/contract'
import { isAddonSecret, isM3uSecret, sanitizeCredentialMap } from '../../../shared/secure-credentials'

export type { SecureCredentialsLossNotice }

type CredentialMap = Record<string, XtreamCredentials>

/** The secure store's contents, split by kind. */
export interface SourceSecrets {
  xtream: CredentialMap
  /** Playlist URL per `m3u_url` source. */
  m3uUrls: Record<string, string>
  /** Base address per `addon` source (always set by `splitSourceSecrets`). */
  addonUrls?: Record<string, string>
}

export function emptySourceSecrets(): Required<SourceSecrets> {
  return { xtream: {}, m3uUrls: {}, addonUrls: {} }
}

export function splitSourceSecrets(map: SecureCredentialMap): SourceSecrets {
  const secrets = emptySourceSecrets()
  for (const [sourceId, secret] of Object.entries(map)) {
    if (isM3uSecret(secret)) secrets.m3uUrls[sourceId] = secret.url
    else if (isAddonSecret(secret)) secrets.addonUrls[sourceId] = secret.url
    else secrets.xtream[sourceId] = secret
  }
  return secrets
}

export const secureCredentialService = {
  async getAllSecrets(): Promise<SourceSecrets> {
    if (!window.electron?.getSecureCredentials) return emptySourceSecrets()
    const raw = await window.electron.getSecureCredentials()
    return splitSourceSecrets(sanitizeCredentialMap(raw))
  },

  async set(sourceId: string, credential: XtreamCredentials): Promise<void> {
    if (!window.electron?.setSecureCredential) return
    await window.electron.setSecureCredential(sourceId, credential)
  },

  /** Stores the playlist URL of an `m3u_url` source (it usually holds the account password). */
  async setM3uUrl(sourceId: string, url: string): Promise<void> {
    if (!window.electron?.setSecureCredential) return
    await window.electron.setSecureCredential(sourceId, { kind: 'm3u_url', url })
  },

  /** Stores the base address of an `addon` source (its settings segment may hold a personal key). */
  async setAddonUrl(sourceId: string, url: string): Promise<void> {
    if (!window.electron?.setSecureCredential) return
    await window.electron.setSecureCredential(sourceId, { kind: 'addon', url })
  },

  /** The stored TMDB API key, or null when there is none (or no Electron). */
  async getTmdbApiKey(): Promise<string | null> {
    if (!window.electron?.getSecureTmdbApiKey) return null
    return window.electron.getSecureTmdbApiKey()
  },

  /** Stores the TMDB API key; an empty key removes it. */
  async setTmdbApiKey(apiKey: string): Promise<void> {
    if (!window.electron?.setSecureTmdbApiKey) return
    await window.electron.setSecureTmdbApiKey(apiKey.trim() || null)
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
