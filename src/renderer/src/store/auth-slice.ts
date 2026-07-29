import type { StateCreator } from 'zustand'
import type { PlaylistSource } from '@/types/playlist'
import type { XtreamCredentials, XtreamAuthResponse } from '@/types/xtream'

export interface AuthSlice {
  sources: PlaylistSource[]
  activeSourceId: string | null
  xtreamAuth: Record<string, XtreamAuthResponse>
  credentialsHydrated: boolean
  isLoading: boolean
  error: string | null
  /** Bumped to ask useAutoConnect to retry every source immediately. */
  connectRetryToken: number
  addSource: (source: PlaylistSource) => void
  removeSource: (id: string) => void
  setActiveSource: (id: string | null) => void
  setXtreamAuth: (sourceId: string, auth: XtreamAuthResponse) => void
  hydrateXtreamCredentials: (credentialsBySource: Record<string, XtreamCredentials>) => void
  setCredentialsHydrated: (hydrated: boolean) => void
  setAuthLoading: (loading: boolean) => void
  setAuthError: (error: string | null) => void
  requestSourceReconnect: () => void
  getActiveSource: () => PlaylistSource | null
  getXtreamCredentials: (sourceId: string) => XtreamCredentials | null
}

export const createAuthSlice: StateCreator<AuthSlice, [], [], AuthSlice> = (set, get) => ({
  sources: [],
  activeSourceId: null,
  xtreamAuth: {},
  credentialsHydrated: false,
  isLoading: false,
  error: null,
  connectRetryToken: 0,

  addSource: (source) =>
    set((state) => ({
      sources: [...state.sources.filter((s) => s.id !== source.id), source]
    })),

  removeSource: (id) =>
    set((state) => {
      const nextSources = state.sources.filter((s) => s.id !== id)
      const nextActiveSourceId =
        state.activeSourceId === id ? (nextSources[0]?.id ?? null) : state.activeSourceId

      const auth = { ...state.xtreamAuth }
      delete auth[id]

      return {
        sources: nextSources,
        activeSourceId: nextActiveSourceId,
        xtreamAuth: auth
      }
    }),

  setActiveSource: (id) => set({ activeSourceId: id }),

  setXtreamAuth: (sourceId, auth) =>
    set((state) => ({ xtreamAuth: { ...state.xtreamAuth, [sourceId]: auth } })),

  hydrateXtreamCredentials: (credentialsBySource) =>
    set((state) => ({
      sources: state.sources.map((source) => {
        if (source.type !== 'xtream') return source
        const creds = credentialsBySource[source.id]
        if (!creds) return source
        return {
          ...source,
          url: creds.url,
          username: creds.username,
          password: creds.password
        }
      }),
      credentialsHydrated: true
    })),

  setCredentialsHydrated: (hydrated) => set({ credentialsHydrated: hydrated }),
  setAuthLoading: (loading) => set({ isLoading: loading }),
  setAuthError: (error) => set({ error }),

  requestSourceReconnect: () =>
    set((state) => ({ connectRetryToken: state.connectRetryToken + 1, error: null })),

  getActiveSource: () => {
    const { sources, activeSourceId } = get()
    return sources.find((s) => s.id === activeSourceId) || null
  },

  getXtreamCredentials: (sourceId) => {
    const source = get().sources.find((s) => s.id === sourceId)
    if (!source || source.type !== 'xtream' || !source.url || !source.username || !source.password)
      return null
    return { url: source.url, username: source.username, password: source.password }
  }
})
