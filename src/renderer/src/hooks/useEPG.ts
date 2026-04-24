import { useEffect, useRef } from 'react'
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
  const epgSourceId = useStore((s) => s.epgSourceId)
  const epgData = useStore((s) => s.epgData)
  const epgLoading = useStore((s) => s.epgLoading)
  const epgLastFetched = useStore((s) => s.epgLastFetched)
  const epgRefreshInterval = useStore((s) => s.settings.epgRefreshInterval)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const inFlightRef = useRef(false)
  const isEPGRoute = location.pathname.startsWith('/epg')

  useEffect(() => {
    if (!isEPGRoute) return
    if (!activeSourceId) return
    if (inFlightRef.current) return

    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return

    const creds = getXtreamCredentials(source.id)
    if (!creds) return

    const refreshMinutes = Math.min(
      MAX_EPG_REFRESH_MINUTES,
      Math.max(MIN_EPG_REFRESH_MINUTES, Math.floor(epgRefreshInterval || 60))
    )
    const staleMs = refreshMinutes * 60 * 1000
    const hasCurrentSourceEpg = epgSourceId === activeSourceId
    const isStale = !hasCurrentSourceEpg || !epgData || !epgLastFetched || Date.now() - epgLastFetched > staleMs

    if (!isStale) return

    let cancelled = false
    inFlightRef.current = true

    const { setEpgData, setEpgLoading, setEpgError } = useStore.getState()
    setEpgLoading(true)
    setEpgError(null)

    const epgUrl = xtreamApi.buildEpgUrl(creds)

    fetchAndParseEPG(epgUrl)
      .then((data) => {
        if (!cancelled) setEpgData(source.id, data)
      })
      .catch((err) => {
        if (!cancelled) setEpgError(err instanceof Error ? err.message : 'EPG verisi alınamadı')
      })
      .finally(() => {
        if (!cancelled) setEpgLoading(false)
        inFlightRef.current = false
      })

    return () => {
      cancelled = true
    }
  }, [isEPGRoute, activeSourceId, sources, epgSourceId, epgData, epgLastFetched, epgRefreshInterval, getXtreamCredentials])

  // Auto-refresh interval while on EPG route
  useEffect(() => {
    if (!isEPGRoute) return
    if (!activeSourceId) return

    const refreshMinutes = Math.min(
      MAX_EPG_REFRESH_MINUTES,
      Math.max(MIN_EPG_REFRESH_MINUTES, Math.floor(epgRefreshInterval || 60))
    )
    const staleMs = refreshMinutes * 60 * 1000

    const interval = setInterval(() => {
      if (inFlightRef.current) return
      const source = sources.find((s) => s.id === activeSourceId)
      if (!source || source.type !== 'xtream') return
      const creds = getXtreamCredentials(source.id)
      if (!creds) return

      inFlightRef.current = true
      const { setEpgData, setEpgLoading, setEpgError } = useStore.getState()
      setEpgLoading(true)

      fetchAndParseEPG(xtreamApi.buildEpgUrl(creds))
        .then((data) => setEpgData(source.id, data))
        .catch((err) => setEpgError(err instanceof Error ? err.message : 'EPG yenilemesi başarısız'))
        .finally(() => {
          setEpgLoading(false)
          inFlightRef.current = false
        })
    }, staleMs)

    return () => clearInterval(interval)
  }, [isEPGRoute, activeSourceId, sources, epgRefreshInterval, getXtreamCredentials])

  return { epgData: activeSourceId && epgSourceId === activeSourceId ? epgData : null, epgLoading }
}
