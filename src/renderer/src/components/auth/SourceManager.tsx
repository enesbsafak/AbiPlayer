import { useState } from 'react'
import { Trash2, RefreshCw, Check, Wifi, WifiOff, Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { xtreamApi } from '@/services/xtream-api'
import { fetchAndParseM3U, parseM3U } from '@/services/m3u-parser'
import { secureCredentialService } from '@/services/secure-credentials'
import { pickAndReadFile } from '@/services/platform'
import { toUserMessage } from '@/services/user-error'
import type { Category, Channel, PlaylistSource } from '@/types/playlist'

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function sourceStillExists(sourceId: string): boolean {
  return useStore.getState().sources.some((source) => source.id === sourceId)
}

const SOURCE_TYPE_LABELS: Record<PlaylistSource['type'], string> = {
  xtream: 'Xtream Codes',
  m3u_url: 'M3U URL',
  m3u_file: 'M3U Dosya'
}

export function SourceManager() {
  const sources = useStore((s) => s.sources)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const xtreamAuth = useStore((s) => s.xtreamAuth)
  const setActiveSource = useStore((s) => s.setActiveSource)
  const removeSource = useStore((s) => s.removeSource)
  const removeChannelsBySource = useStore((s) => s.removeChannelsBySource)
  const removeCategoriesBySource = useStore((s) => s.removeCategoriesBySource)
  const setXtreamAuth = useStore((s) => s.setXtreamAuth)
  const addChannels = useStore((s) => s.addChannels)
  const addCategories = useStore((s) => s.addCategories)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const clearEpg = useStore((s) => s.clearEpg)

  // A set, not one id: two refreshes can overlap, and the first to finish
  // used to clear the spinner of the other.
  const [refreshingIds, setRefreshingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [refreshError, setRefreshError] = useState<Record<string, string>>({})
  const [pendingRemoval, setPendingRemoval] = useState<PlaylistSource | null>(null)

  const setRefreshing = (sourceId: string, refreshing: boolean) => {
    setRefreshingIds((previous) => {
      if (previous.has(sourceId) === refreshing) return previous
      const next = new Set(previous)
      if (refreshing) next.add(sourceId)
      else next.delete(sourceId)
      return next
    })
  }

  // Swap in one go once the new list is in hand. Clearing first meant a
  // network error left the source with no channels at all.
  const replaceCatalog = (sourceId: string, channels: Channel[], categories: Category[]) => {
    removeChannelsBySource(sourceId)
    removeCategoriesBySource(sourceId)
    addChannels(channels)
    addCategories(categories)
  }

  const handleRemove = async (source: PlaylistSource) => {
    if (source.type === 'xtream') {
      try {
        await secureCredentialService.delete(source.id)
      } catch (err) {
        console.error('Failed to remove secure credentials:', err)
      }
    }

    removeSource(source.id)
    removeChannelsBySource(source.id)
    removeCategoriesBySource(source.id)
    clearEpg()
    setRefreshError((prev) => withoutKey(prev, source.id))
  }

  const handleRefresh = async (sourceId: string) => {
    const source = sources.find((s) => s.id === sourceId)
    if (!source || refreshingIds.has(sourceId)) return

    setRefreshing(sourceId, true)
    setRefreshError((prev) => withoutKey(prev, sourceId))

    try {
      if (source.type === 'xtream') {
        const creds = getXtreamCredentials(sourceId)
        if (!creds) throw new Error('Kimlik bilgileri bulunamadı')
        const auth = await xtreamApi.authenticate(creds)
        if (auth.user_info.auth !== 1) {
          throw new Error('Kimlik doğrulama başarısız oldu')
        }
        if (!sourceStillExists(sourceId)) return
        setXtreamAuth(sourceId, auth)
        // Only once the server accepted us: the catalog reloads on the next
        // page visit.
        removeChannelsBySource(sourceId)
        removeCategoriesBySource(sourceId)
        clearEpg()
      } else if (source.type === 'm3u_url' && source.url) {
        const { channels, categories } = await fetchAndParseM3U(source.url, sourceId)
        if (!sourceStillExists(sourceId)) return
        replaceCatalog(sourceId, channels, categories)
      } else if (source.type === 'm3u_file') {
        const result = await pickAndReadFile([
          { name: 'Oynatma Listesi Dosyaları', extensions: ['m3u', 'm3u8', 'txt'] }
        ])
        if (!result) return
        const { channels, categories } = parseM3U(result.content, sourceId)
        if (!sourceStillExists(sourceId)) return
        replaceCatalog(sourceId, channels, categories)
      }
    } catch (err) {
      setRefreshError((prev) => ({ ...prev, [sourceId]: toUserMessage(err, 'Yenileme başarısız oldu.') }))
    } finally {
      setRefreshing(sourceId, false)
    }
  }

  const isConnected = (sourceId: string, type: string) => {
    if (type === 'xtream') return !!xtreamAuth[sourceId]
    return true // M3U sources are always "connected" if they exist
  }

  if (sources.length === 0) {
    return (
      <div className="text-center py-8 text-surface-500">
        <p>Henüz kaynak eklenmedi.</p>
        <p className="text-sm mt-1">Başlamak için bir Xtream Codes sunucusu veya M3U listesi ekleyin.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-surface-400 mb-1">Kaynaklarınız</h3>
      {sources.map((source) => {
        const connected = isConnected(source.id, source.type)
        const isRefreshing = refreshingIds.has(source.id)

        return (
          <div
            key={source.id}
            className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
              source.id === activeSourceId
                ? 'border-accent bg-accent/5'
                : 'border-surface-800 hover:border-surface-700 bg-surface-900'
            }`}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => setActiveSource(source.id)}
              aria-current={source.id === activeSourceId ? 'true' : undefined}
            >
              {source.id === activeSourceId && (
                <Check size={16} className="text-accent shrink-0" aria-hidden="true" />
              )}
              <div className="flex items-center gap-2">
                {connected ? (
                  <Wifi size={14} className="text-green-400 shrink-0" aria-label="Bağlı" />
                ) : (
                  <WifiOff size={14} className="text-surface-500 shrink-0" aria-label="Bağlı değil" />
                )}
                <div>
                  <p className="text-sm font-medium">{source.name}</p>
                  <p className="text-xs text-surface-500">
                    {SOURCE_TYPE_LABELS[source.type]}
                    {source.type === 'xtream' && !connected && ' - yeniden bağlanıyor...'}
                  </p>
                  {refreshError[source.id] && (
                    <p className="text-xs text-red-400 mt-0.5" role="alert">{refreshError[source.id]}</p>
                  )}
                </div>
              </div>
            </button>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={isRefreshing}
                onClick={() => {
                  void handleRefresh(source.id)
                }}
                aria-label={`${source.name} kaynağını yenile`}
                title="Yenile"
              >
                {isRefreshing ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw size={14} aria-hidden="true" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingRemoval(source)}
                aria-label={`${source.name} kaynağını sil`}
                title="Sil"
              >
                <Trash2 size={14} className="text-red-400" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )
      })}

      <ConfirmDialog
        isOpen={pendingRemoval !== null}
        title="Kaynak silinsin mi?"
        confirmLabel="Sil"
        destructive
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          const source = pendingRemoval
          setPendingRemoval(null)
          if (source) void handleRemove(source)
        }}
      >
        <p>
          <span className="font-medium text-surface-100">{pendingRemoval?.name}</span> kaynağı,
          kanalları ve kategorileriyle birlikte kaldırılacak. Bu işlem geri alınamaz; yeniden
          kullanmak için kaynağı tekrar eklemeniz gerekir.
        </p>
      </ConfirmDialog>
    </div>
  )
}
