import { useEffect, useRef } from 'react'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import { fetchAndParseM3U } from '@/services/m3u-parser'
import { secureCredentialService } from '@/services/secure-credentials'

const AUTO_RETRY_INTERVAL_MS = 15_000

/**
 * On app startup, automatically reconnects to saved sources:
 * - Xtream: re-authenticates with stored credentials
 * - M3U URL: re-fetches and parses the playlist
 * - M3U file: skipped (local file may not exist anymore)
 */
export function useAutoConnect() {
  const hydratingRef = useRef(false)
  const inFlightRef = useRef(false)
  const sourceAttemptAtRef = useRef<Record<string, number>>({})
  const sources = useStore((s) => s.sources)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const xtreamAuth = useStore((s) => s.xtreamAuth)
  const channels = useStore((s) => s.channels)
  const credentialsHydrated = useStore((s) => s.credentialsHydrated)
  const setXtreamAuth = useStore((s) => s.setXtreamAuth)
  const hydrateXtreamCredentials = useStore((s) => s.hydrateXtreamCredentials)
  const setCredentialsHydrated = useStore((s) => s.setCredentialsHydrated)
  const setActiveSource = useStore((s) => s.setActiveSource)
  const setAuthLoading = useStore((s) => s.setAuthLoading)
  const setAuthError = useStore((s) => s.setAuthError)
  const addChannels = useStore((s) => s.addChannels)
  const addCategories = useStore((s) => s.addCategories)

  useEffect(() => {
    if (credentialsHydrated || hydratingRef.current) return
    hydratingRef.current = true

    const hydrateCredentials = async () => {
      try {
        const credentialsBySource = await secureCredentialService.getAll()
        const mergedCredentials = { ...credentialsBySource }
        const migrationTasks: Promise<void>[] = []

        // Migrate legacy in-memory credentials (from older localStorage format) into secure storage.
        for (const source of sources) {
          if (source.type !== 'xtream') continue
          if (!source.url || !source.username || !source.password) continue
          if (mergedCredentials[source.id]) continue

          const creds = {
            url: source.url,
            username: source.username,
            password: source.password
          }
          mergedCredentials[source.id] = creds
          migrationTasks.push(secureCredentialService.set(source.id, creds))
        }

        if (migrationTasks.length > 0) {
          await Promise.allSettled(migrationTasks)
        }

        hydrateXtreamCredentials(mergedCredentials)
      } catch (err) {
        console.error('Credential hydration failed:', err)
        setCredentialsHydrated(true)
      } finally {
        hydratingRef.current = false
      }
    }

    void hydrateCredentials()
  }, [credentialsHydrated, sources, hydrateXtreamCredentials, setCredentialsHydrated])

  useEffect(() => {
    if (!credentialsHydrated) return
    if (sources.length === 0) return

    const knownSourceIds = new Set(sources.map((s) => s.id))
    for (const sourceId of Object.keys(sourceAttemptAtRef.current)) {
      if (!knownSourceIds.has(sourceId)) delete sourceAttemptAtRef.current[sourceId]
    }

    const now = Date.now()
    const pendingSources = sources.filter((source) => {
      const lastAttemptAt = sourceAttemptAtRef.current[source.id] ?? 0
      if (now - lastAttemptAt < AUTO_RETRY_INTERVAL_MS) return false

      if (source.type === 'xtream') {
        if (xtreamAuth[source.id]) return false
        return !!(source.url && source.username && source.password)
      }

      if (source.type === 'm3u_url') {
        if (!source.url) return false
        return !channels.some((c) => c.sourceId === source.id)
      }

      return false
    })

    if (pendingSources.length === 0) {
      if (!activeSourceId && sources.length > 0) {
        setActiveSource(sources[0].id)
      }
      return
    }

    if (inFlightRef.current) return

    const connectAll = async (): Promise<void> => {
      inFlightRef.current = true
      setAuthLoading(true)
      setAuthError(null)

      try {
        const results = await Promise.allSettled(
          pendingSources.map(async (source) => {
            sourceAttemptAtRef.current[source.id] = Date.now()

            if (source.type === 'xtream') {
              const creds = { url: source.url!, username: source.username!, password: source.password! }
              const auth = await xtreamApi.authenticate(creds)

              if (auth.user_info.auth === 1) {
                setXtreamAuth(source.id, auth)
                return
              }

              throw new Error('Kimlik dogrulama basarisiz')
            }

            if (source.type === 'm3u_url' && source.url) {
              const { channels: chs, categories: cats } = await fetchAndParseM3U(source.url, source.id)
              addChannels(chs)
              addCategories(cats)
            }
          })
        )

        const rejected = results.find((r) => r.status === 'rejected')
        if (rejected && rejected.status === 'rejected') {
          setAuthError(rejected.reason instanceof Error ? rejected.reason.message : 'Bazi kaynaklara baglanilamadi')
        }

        // Ensure activeSourceId is set if we have sources
        if (!activeSourceId && sources.length > 0) {
          setActiveSource(sources[0].id)
        }
      } finally {
        setAuthLoading(false)
        inFlightRef.current = false
      }
    }

    void connectAll()
  }, [
    credentialsHydrated,
    sources,
    activeSourceId,
    xtreamAuth,
    channels,
    setXtreamAuth,
    setActiveSource,
    setAuthLoading,
    setAuthError,
    addChannels,
    addCategories
  ])
}
