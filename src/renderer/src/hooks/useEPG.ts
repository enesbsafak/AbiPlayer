import { useEffect, useCallback } from 'react'
import { useStore } from '@/store'
import { fetchAndParseEPG } from '@/services/epg-service'
import { xtreamApi } from '@/services/xtream-api'

export function useEPG() {
  const {
    activeSourceId, sources, xtreamAuth,
    epgData, epgLoading, epgLastFetched, settings,
    setEpgData, setEpgLoading, setEpgError, getXtreamCredentials
  } = useStore()

  const fetchEPG = useCallback(async () => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source) return

    setEpgLoading(true)
    try {
      let epgUrl: string | null = null

      if (source.type === 'xtream') {
        const creds = getXtreamCredentials(source.id)
        if (creds) epgUrl = xtreamApi.buildEpgUrl(creds)
      }

      if (!epgUrl) {
        setEpgLoading(false)
        return
      }

      const data = await fetchAndParseEPG(epgUrl)
      setEpgData(data)
    } catch (err) {
      setEpgError(err instanceof Error ? err.message : 'Failed to fetch EPG')
    } finally {
      setEpgLoading(false)
    }
  }, [activeSourceId, sources, getXtreamCredentials, setEpgData, setEpgLoading, setEpgError])

  useEffect(() => {
    if (!activeSourceId) return

    // Fetch if no data or stale
    const staleMs = settings.epgRefreshInterval * 60 * 1000
    if (!epgData || !epgLastFetched || Date.now() - epgLastFetched > staleMs) {
      fetchEPG()
    }

    // Auto refresh
    const interval = setInterval(fetchEPG, staleMs)
    return () => clearInterval(interval)
  }, [activeSourceId, epgData, epgLastFetched, settings.epgRefreshInterval, fetchEPG])

  return { epgData, epgLoading, refetchEPG: fetchEPG }
}
