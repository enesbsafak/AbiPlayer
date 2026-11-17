import type { StateCreator } from 'zustand'
import { canBeActiveSource } from '@/addons/manifest'
import type { PlaylistSource } from '@/types/playlist'
import type { XtreamCredentials, XtreamAuthResponse } from '@/types/xtream'

/**
 * Why a saved source is not connected. Set by useAutoConnect (and the source
 * manager) and shown on the source.
 */
export interface SourceConnectionError {
  /** Already a user message (`toUserMessage`). */
  message: string
  /**
   * `auth`: the provider refused the account, no automatic retry.
   * `file`: a local playlist could not be read again; it has to be picked again.
   * `missing-secret`: the stored credential or playlist URL is gone (or the
   *   secure store cannot be read right now); the user can enter it again.
   * `other`: anything else, retried automatically.
   */
  kind: 'auth' | 'file' | 'missing-secret' | 'other'
  /** When the next automatic attempt starts (epoch ms), or null when none is planned. */
  retryAt: number | null
}

/** Stored secrets of the sources, by kind (see `secureCredentialService.getAllSecrets`). */
export interface HydratedSourceSecrets {
  xtream: Record<string, XtreamCredentials>
  m3uUrls: Record<string, string>
  addonUrls?: Record<string, string>
}

/**
 * An `addon` source connected in this session (session state, not
 * persisted). `manifestFresh` is false when the add-on could not be reached
 * and its stored manifest summary is in use.
 */
export interface AddonSessionState {
  manifestFresh: boolean
}

export interface AuthSlice {
  sources: PlaylistSource[]
  activeSourceId: string | null
  xtreamAuth: Record<string, XtreamAuthResponse>
  /** Add-on sources connected in this session; what `xtreamAuth` is to Xtream sources. */
  addonSessions: Record<string, AddonSessionState>
  credentialsHydrated: boolean
  isLoading: boolean
  error: string | null
  /** Bumped to ask useAutoConnect to retry every source immediately. */
  connectRetryToken: number
  /** Per source, while it is not connected. */
  sourceErrors: Record<string, SourceConnectionError>
  /**
   * Sources whose secret (Xtream username and password, M3U URL) was loaded
   * from the plain persisted state of an older version and is not in the
   * secure store yet. Their plain copy keeps being written until the secure
   * write succeeded, so a failed migration never loses the credential.
   */
  legacySecretSourceIds: string[]
  /** Set when moving plain secrets to the secure store failed; a user message. */
  secretMigrationError: string | null
  /**
   * Set while the secure store could not be read at all (a user message). The
   * stored secrets are still there: the read is retried, and the sources wait
   * for it instead of asking the user to add them again.
   */
  secretStoreError: string | null
  addSource: (source: PlaylistSource) => void
  /** Changes fields of a source in place (its position in the list stays). */
  updateSource: (id: string, patch: Partial<Omit<PlaylistSource, 'id' | 'type'>>) => void
  removeSource: (id: string) => void
  setActiveSource: (id: string | null) => void
  setXtreamAuth: (sourceId: string, auth: XtreamAuthResponse) => void
  setAddonSession: (sourceId: string, session: AddonSessionState | null) => void
  /** Puts the stored secrets on the sources and marks the credentials hydrated. */
  hydrateSourceSecrets: (secrets: HydratedSourceSecrets) => void
  setCredentialsHydrated: (hydrated: boolean) => void
  setAuthLoading: (loading: boolean) => void
  setAuthError: (error: string | null) => void
  setSourceError: (sourceId: string, error: SourceConnectionError | null) => void
  /** The secure store now holds these sources' secrets: stop writing the plain copy. */
  markSecretsMigrated: (sourceIds: readonly string[]) => void
  setSecretMigrationError: (message: string | null) => void
  setSecretStoreError: (message: string | null) => void
  requestSourceReconnect: () => void
  getXtreamCredentials: (sourceId: string) => XtreamCredentials | null
}

/** The secret a source carries in memory, if any. */
export function plainSecretOf(
  source: PlaylistSource
): XtreamCredentials | { m3uUrl: string } | { addonUrl: string } | null {
  switch (source.type) {
    case 'xtream':
      if (!source.url || !source.username || !source.password) return null
      return { url: source.url, username: source.username, password: source.password }
    case 'm3u_url':
      return source.url ? { m3uUrl: source.url } : null
    case 'addon':
      return source.url ? { addonUrl: source.url } : null
    case 'm3u_file':
      // A file path is not a secret: it is persisted as it is.
      return null
  }
}

/**
 * The source's secret lives in the secure store (and goes from there with
 * it). A built-in catalogue has none: it asks with the TMDB key of the
 * settings.
 */
export function keepsSecretInStore(source: Pick<PlaylistSource, 'type' | 'builtin'>): boolean {
  return source.type !== 'm3u_file' && !(source.type === 'addon' && source.builtin !== undefined)
}

/** The source needs a secret from the secure store before it can connect. */
export function needsStoredSecret(source: PlaylistSource): boolean {
  return keepsSecretInStore(source) && plainSecretOf(source) === null
}

/**
 * The source as written to localStorage: no Xtream username or password, no
 * M3U playlist URL and no add-on address (all live in the secure store),
 * unless the source still waits for its secret to be migrated there. An
 * add-on keeps its manifest summary, which holds nothing secret.
 */
export function persistableSource(source: PlaylistSource, keepPlainSecret: boolean): PlaylistSource {
  if (keepPlainSecret) return source
  switch (source.type) {
    case 'xtream': {
      const { username: _username, password: _password, ...safe } = source
      return safe
    }
    case 'm3u_url':
    case 'addon': {
      const { url: _url, ...safe } = source
      return safe
    }
    case 'm3u_file':
      return source
  }
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

export const createAuthSlice: StateCreator<AuthSlice, [], [], AuthSlice> = (set, get) => ({
  sources: [],
  activeSourceId: null,
  xtreamAuth: {},
  addonSessions: {},
  credentialsHydrated: false,
  isLoading: false,
  error: null,
  connectRetryToken: 0,
  sourceErrors: {},
  legacySecretSourceIds: [],
  secretMigrationError: null,
  secretStoreError: null,

  addSource: (source) =>
    set((state) => ({
      sources: [...state.sources.filter((s) => s.id !== source.id), source],
      sourceErrors: withoutKey(state.sourceErrors, source.id)
    })),

  updateSource: (id, patch) =>
    set((state) => {
      if (!state.sources.some((source) => source.id === id)) return state
      return { sources: state.sources.map((source) => (source.id === id ? { ...source, ...patch } : source)) }
    }),

  removeSource: (id) =>
    set((state) => {
      const nextSources = state.sources.filter((s) => s.id !== id)
      const nextActiveSourceId =
        state.activeSourceId === id ? (nextSources.find(canBeActiveSource)?.id ?? null) : state.activeSourceId

      const auth = { ...state.xtreamAuth }
      delete auth[id]

      return {
        sources: nextSources,
        activeSourceId: nextActiveSourceId,
        xtreamAuth: auth,
        addonSessions: withoutKey(state.addonSessions, id),
        sourceErrors: withoutKey(state.sourceErrors, id),
        legacySecretSourceIds: state.legacySecretSourceIds.includes(id)
          ? state.legacySecretSourceIds.filter((sourceId) => sourceId !== id)
          : state.legacySecretSourceIds
      }
    }),

  setActiveSource: (id) => set({ activeSourceId: id }),

  setAddonSession: (sourceId, session) =>
    set((state) => {
      if (!session) return sourceId in state.addonSessions ? { addonSessions: withoutKey(state.addonSessions, sourceId) } : state
      return {
        addonSessions: { ...state.addonSessions, [sourceId]: session },
        sourceErrors: withoutKey(state.sourceErrors, sourceId)
      }
    }),

  setXtreamAuth: (sourceId, auth) =>
    set((state) => ({
      xtreamAuth: { ...state.xtreamAuth, [sourceId]: auth },
      sourceErrors: withoutKey(state.sourceErrors, sourceId)
    })),

  hydrateSourceSecrets: ({ xtream, m3uUrls, addonUrls = {} }) =>
    set((state) => ({
      sources: state.sources.map((source) => {
        switch (source.type) {
          case 'xtream': {
            const creds = xtream[source.id]
            if (!creds) return source
            return { ...source, url: creds.url, username: creds.username, password: creds.password }
          }
          case 'm3u_url': {
            const url = m3uUrls[source.id]
            return url ? { ...source, url } : source
          }
          case 'addon': {
            const url = addonUrls[source.id]
            return url ? { ...source, url } : source
          }
          case 'm3u_file':
            return source
        }
      }),
      credentialsHydrated: true
    })),

  setCredentialsHydrated: (hydrated) => set({ credentialsHydrated: hydrated }),
  setAuthLoading: (loading) => set({ isLoading: loading }),
  setAuthError: (error) => set({ error }),

  setSourceError: (sourceId, error) =>
    set((state) => {
      if (!error) {
        return sourceId in state.sourceErrors ? { sourceErrors: withoutKey(state.sourceErrors, sourceId) } : state
      }
      return { sourceErrors: { ...state.sourceErrors, [sourceId]: error } }
    }),

  markSecretsMigrated: (sourceIds) =>
    set((state) => {
      const done = new Set(sourceIds)
      if (!state.legacySecretSourceIds.some((id) => done.has(id))) return state
      return { legacySecretSourceIds: state.legacySecretSourceIds.filter((id) => !done.has(id)) }
    }),

  setSecretMigrationError: (message) => set({ secretMigrationError: message }),
  setSecretStoreError: (message) => set({ secretStoreError: message }),

  requestSourceReconnect: () =>
    set((state) => ({ connectRetryToken: state.connectRetryToken + 1, error: null })),

  getXtreamCredentials: (sourceId) => {
    const source = get().sources.find((s) => s.id === sourceId)
    if (!source || source.type !== 'xtream' || !source.url || !source.username || !source.password)
      return null
    return { url: source.url, username: source.username, password: source.password }
  }
})
