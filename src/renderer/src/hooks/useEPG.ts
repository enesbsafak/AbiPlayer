import { useEffect, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '@/store'
import { fetchAndParseEPG } from '@/services/epg-service'
import { xtreamApi } from '@/services/xtream-api'

const MIN_EPG_REFRESH_MINUTES = 5
const MAX_EPG_REFRESH_MINUTES = 1440

export function useEPG() {
  const location = useLocation()
  const activeSourceId = useStore((s) => s.activeSourceId)
  const sources = useStore((s) => s.sources)
  const epgData = useStore((s) => s.epgData)
  const epgLoading = useStore((s) => s.epgLoading)
  const epgLastFetched = useStore((s) => s.epgLastFetched)
  const epgRefreshInterval = useStore((s) => s.settings.epgRefreshInterval)
  const setEpgData = useStore((s) => s.setEpgData)
  const setEpgLoading = useStore((s) => s.setEpgLoading)
  const setEpgError = useStore((s) => s.setEpgError)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const inFlightRef = useRef(false)
  const isEPGRoute = location.pathname.startsWith('/epg')

  const fetchEPG = useCallback(async () => {
    if (inFlightRef.current) return
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source) return

    inFlightRef.current = true
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
      setEpgError(err instanceof Error ? err.message : 'EPG verisi alinamadi')
    } finally {
      setEpgLoading(false)
      inFlightRef.current = false
    }
  }, [activeSourceId, sources, getXtreamCredentials, setEpgData, setEpgLoading, setEpgError])

  useEffect(() => {
    if (!activeSourceId) return
    if (!isEPGRoute) return

    const refreshMinutes = Math.min(
      MAX_EPG_REFRESH_MINUTES,
      Math.max(MIN_EPG_REFRESH_MINUTES, Math.floor(epgRefreshInterval || 60))
    )
    // Fetch if no data or stale
    const staleMs = refreshMinutes * 60 * 1000
    if (!epgData || !epgLastFetched || Date.now() - epgLastFetched > staleMs) {
      fetchEPG()
    }

    // Auto refresh
    const interval = setInterval(fetchEPG, staleMs)
    return () => clearInterval(interval)
  }, [activeSourceId, isEPGRoute, epgData, epgLastFetched, epgRefreshInterval, fetchEPG])

  return { epgData, epgLoading, refetchEPG: fetchEPG }
}
