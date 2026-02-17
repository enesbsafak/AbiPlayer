import { useEffect, useRef } from 'react'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import { fetchAndParseM3U } from '@/services/m3u-parser'

/**
 * On app startup, automatically reconnects to saved sources:
 * - Xtream: re-authenticates with stored credentials
 * - M3U URL: re-fetches and parses the playlist
 * - M3U file: skipped (local file may not exist anymore)
 */
export function useAutoConnect() {
  const ranRef = useRef(false)
  const {
    sources,
    activeSourceId,
    xtreamAuth,
    channels,
    setXtreamAuth,
    setActiveSource,
    setAuthLoading,
    setAuthError,
    addChannels,
    addCategories,
    getXtreamCredentials
  } = useStore()

  useEffect(() => {
    // Only run once on mount
    if (ranRef.current) return
    ranRef.current = true

    if (sources.length === 0) return

    const connectAll = async () => {
      setAuthLoading(true)
      setAuthError(null)

      for (const source of sources) {
        try {
          if (source.type === 'xtream') {
            // Re-authenticate if we don't have auth for this source
            if (xtreamAuth[source.id]) continue

            const creds = { url: source.url!, username: source.username!, password: source.password! }
            const auth = await xtreamApi.authenticate(creds)

            if (auth.user_info.auth === 1) {
              setXtreamAuth(source.id, auth)
            }
          } else if (source.type === 'm3u_url' && source.url) {
            // Re-fetch M3U if we don't have channels for this source
            const hasChannels = channels.some((c) => c.sourceId === source.id)
            if (hasChannels) continue

            const { channels: chs, categories: cats } = await fetchAndParseM3U(source.url, source.id)
            addChannels(chs)
            addCategories(cats)
          }
          // m3u_file: skip - requires electron file read, will be handled on demand
        } catch (err) {
          console.warn(`Auto-connect failed for ${source.name}:`, err)
        }
      }

      // Ensure activeSourceId is set if we have sources
      if (!activeSourceId && sources.length > 0) {
        setActiveSource(sources[0].id)
      }

      setAuthLoading(false)
    }

    connectAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
