import { useState } from 'react'
import { Trash2, RefreshCw, Check, Wifi, WifiOff, Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { xtreamApi } from '@/services/xtream-api'
import { fetchAndParseM3U } from '@/services/m3u-parser'
import { secureCredentialService } from '@/services/secure-credentials'

export function SourceManager() {
  const {
    sources, activeSourceId, xtreamAuth,
    setActiveSource, removeSource, removeChannelsBySource, removeCategoriesBySource,
    setXtreamAuth, addChannels, addCategories, getXtreamCredentials, clearEpg
  } = useStore()
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  const handleRemove = async (id: string, type: string) => {
    if (type === 'xtream') {
      try {
        await secureCredentialService.delete(id)
      } catch (err) {
        console.error('Failed to remove secure credentials:', err)
      }
    }

    removeSource(id)
    removeChannelsBySource(id)
    removeCategoriesBySource(id)
    clearEpg()
  }

  const handleRefresh = async (sourceId: string) => {
    const source = sources.find((s) => s.id === sourceId)
    if (!source) return

    setRefreshingId(sourceId)
    try {
      if (source.type === 'xtream') {
        const creds = getXtreamCredentials(sourceId)
        if (!creds) return
        // Re-authenticate
        const auth = await xtreamApi.authenticate(creds)
        if (auth.user_info.auth === 1) {
          setXtreamAuth(sourceId, auth)
        }
        // Clear old channels and reload on next page visit
        removeChannelsBySource(sourceId)
        removeCategoriesBySource(sourceId)
        clearEpg()
      } else if (source.type === 'm3u_url' && source.url) {
        removeChannelsBySource(sourceId)
        removeCategoriesBySource(sourceId)
        const { channels, categories } = await fetchAndParseM3U(source.url, sourceId)
        addChannels(channels)
        addCategories(categories)
      }
    } catch (err) {
      console.error('Refresh failed:', err)
    } finally {
      setRefreshingId(null)
    }
  }

  const isConnected = (sourceId: string, type: string) => {
    if (type === 'xtream') return !!xtreamAuth[sourceId]
    return true // M3U sources are always "connected" if they exist
  }

  if (sources.length === 0) {
    return (
      <div className="text-center py-8 text-surface-500">
        <p>Henuz kaynak eklenmedi.</p>
        <p className="text-sm mt-1">Baslamak icin bir Xtream Codes sunucusu veya M3U listesi ekleyin.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-surface-400 mb-1">Kaynaklariniz</h3>
      {sources.map((source) => {
        const connected = isConnected(source.id, source.type)
        const isRefreshing = refreshingId === source.id

        return (
          <div
            key={source.id}
            className={`flex items-center justify-between rounded-lg border p-3 transition-colors cursor-pointer ${
              source.id === activeSourceId
                ? 'border-accent bg-accent/5'
                : 'border-surface-700 hover:border-surface-600 bg-surface-900'
            }`}
            onClick={() => setActiveSource(source.id)}
          >
            <div className="flex items-center gap-3">
              {source.id === activeSourceId && (
                <Check size={16} className="text-accent shrink-0" />
              )}
              <div className="flex items-center gap-2">
                {connected ? (
                  <Wifi size={14} className="text-green-400 shrink-0" />
                ) : (
                  <WifiOff size={14} className="text-surface-500 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium">{source.name}</p>
                  <p className="text-xs text-surface-500">
                    {source.type === 'xtream' ? 'Xtream Codes' : source.type === 'm3u_url' ? 'M3U URL' : 'M3U Dosya'}
                    {source.type === 'xtream' && !connected && ' - yeniden baglaniyor...'}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={isRefreshing}
                onClick={(e) => { e.stopPropagation(); handleRefresh(source.id) }}
              >
                {isRefreshing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleRemove(source.id, source.type)
                }}
              >
                <Trash2 size={14} className="text-red-400" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
