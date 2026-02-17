import { useCallback } from 'react'
import { EPGGrid } from '@/components/epg/EPGGrid'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { RefreshCw } from 'lucide-react'
import { useStore } from '@/store'
import { fetchAndParseEPG } from '@/services/epg-service'
import { xtreamApi } from '@/services/xtream-api'

export default function EPGPage() {
  const epgLoading = useStore((s) => s.epgLoading)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const sources = useStore((s) => s.sources)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const setEpgData = useStore((s) => s.setEpgData)
  const setEpgLoading = useStore((s) => s.setEpgLoading)
  const setEpgError = useStore((s) => s.setEpgError)

  const refetchEPG = useCallback(async () => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return

    const creds = getXtreamCredentials(source.id)
    if (!creds) {
      setEpgError('Bu kaynak icin giris bilgileri bulunamadi')
      return
    }

    setEpgLoading(true)
    setEpgError(null)
    try {
      const data = await fetchAndParseEPG(xtreamApi.buildEpgUrl(creds))
      setEpgData(data)
    } catch (err) {
      setEpgError(err instanceof Error ? err.message : 'EPG verisi alinamadi')
    } finally {
      setEpgLoading(false)
    }
  }, [activeSourceId, sources, getXtreamCredentials, setEpgData, setEpgError, setEpgLoading])

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Yayin Akisi</h1>
        <Button variant="secondary" size="sm" onClick={refetchEPG} disabled={epgLoading}>
          {epgLoading ? <Spinner size={14} /> : <RefreshCw size={14} />}
          EPG Yenile
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <EPGGrid />
      </div>
    </div>
  )
}
