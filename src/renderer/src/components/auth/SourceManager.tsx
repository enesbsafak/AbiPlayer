import { useState } from 'react'
import { Trash2, RefreshCw, Check, Wifi, WifiOff, Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { forgetXtreamRequests, xtreamApi } from '@/services/xtream-api'
import { secureCredentialService } from '@/services/secure-credentials'
import { pickAndReadFile } from '@/services/platform'
import { toUserMessage } from '@/services/user-error'
import { catalog } from '@/catalog/catalog-store'
import { reloadSourceCatalog } from '@/catalog/cache-lifecycle'
import { ingestDropped, ingestM3uText } from '@/catalog/worker-ingest'
import { needsStoredSecret } from '@/store/auth-slice'
import type { PlaylistSource } from '@/types/playlist'
import { SourceSecretForm } from './SourceSecretForm'

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
  const replaceSourceCatalog = useStore((s) => s.replaceSourceCatalog)
  const removeSourceCatalog = useStore((s) => s.removeSourceCatalog)
  const setXtreamAuth = useStore((s) => s.setXtreamAuth)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const clearEpg = useStore((s) => s.clearEpg)
  const sourceErrors = useStore((s) => s.sourceErrors)
  const setSourceError = useStore((s) => s.setSourceError)
  const updateSource = useStore((s) => s.updateSource)
  const [removalError, setRemovalError] = useState<string | null>(null)

  // A set, not one id: two refreshes can overlap, and the first to finish
  // used to clear the spinner of the other.
  const [refreshingIds, setRefreshingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [refreshError, setRefreshError] = useState<Record<string, string>>({})
  const [pendingRemoval, setPendingRemoval] = useState<PlaylistSource | null>(null)
  // Sources whose secret is being entered again, in place (K3).
  const [editingSecret, setEditingSecret] = useState<string | null>(null)
  const credentialsHydrated = useStore((s) => s.credentialsHydrated)
  const secretStoreError = useStore((s) => s.secretStoreError)

  const setRefreshing = (sourceId: string, refreshing: boolean) => {
    setRefreshingIds((previous) => {
      if (previous.has(sourceId) === refreshing) return previous
      const next = new Set(previous)
      if (refreshing) next.add(sourceId)
      else next.delete(sourceId)
      return next
    })
  }

  const handleRemove = async (source: PlaylistSource) => {
    setRemovalError(null)
    if (source.type === 'xtream' || source.type === 'm3u_url') {
      try {
        await secureCredentialService.delete(source.id)
      } catch (err) {
        // The source still goes, as asked; the user learns that its stored
        // sign-in could not be wiped instead of it failing silently.
        setRemovalError(
          `"${source.name}" kaldırıldı, ancak kayıtlı giriş bilgisi güvenli depodan silinemedi: ${toUserMessage(err)}`
        )
      }
    }

    removeSource(source.id)
    // Also cancels its running syncs and forgets its hidden categories.
    removeSourceCatalog(source.id)
    clearEpg()
    setRefreshError((prev) => withoutKey(prev, source.id))
  }

  const handleRefresh = async (sourceId: string) => {
    const source = sources.find((s) => s.id === sourceId)
    if (!source || refreshingIds.has(sourceId)) return

    setRefreshing(sourceId, true)
    setRefreshError((prev) => withoutKey(prev, sourceId))
    // The swap below is dropped if the source is removed, or refreshed again,
    // while this one is still fetching.
    const revision = catalog.getSourceRevision(sourceId)

    try {
      if (source.type === 'xtream') {
        const creds = getXtreamCredentials(sourceId)
        if (!creds) throw new Error('Kimlik bilgileri bulunamadı')
        const auth = await xtreamApi.authenticate(creds)
        if (auth.user_info.auth !== 1) {
          throw new Error('Kimlik doğrulama başarısız oldu')
        }
        if (!sourceStillExists(sourceId)) return
        // Only once the server accepted us. The lists stay on screen, marked
        // incomplete: the next full sync replaces them, so items the provider
        // removed disappear. Hidden categories are kept. The pages fetch
        // their lists from the panel again, not from the request cache.
        forgetXtreamRequests(creds)
        replaceSourceCatalog(sourceId, null, revision)
        setXtreamAuth(sourceId, auth)
        clearEpg()
      } else if (source.type === 'm3u_url' && source.url) {
        // Downloaded and parsed in the catalog worker and swapped in once
        // complete: a network error leaves the current list on screen.
        await reloadSourceCatalog(sourceId)
      } else if (source.type === 'm3u_file') {
        const result = await pickAndReadFile([
          { name: 'Oynatma Listesi Dosyaları', extensions: ['m3u', 'm3u8', 'txt'] }
        ])
        if (!result) return
        if (!sourceStillExists(sourceId)) return
        // Parsed in the worker and cached under the file picked now.
        const outcome = await ingestM3uText(sourceId, result.content, result.path)
        if (!sourceStillExists(sourceId)) return
        if (ingestDropped(outcome)) throw new Error('Liste yüklenirken kaynak yeniden yüklendi. Tekrar deneyin.')
        // The file may have been picked from a new place: the next start reads it from there.
        if (result.path !== source.filePath) updateSource(sourceId, { filePath: result.path })
        setSourceError(sourceId, null)
      }
    } catch (err) {
      setRefreshError((prev) => ({ ...prev, [sourceId]: toUserMessage(err, 'Yenileme başarısız oldu.') }))
    } finally {
      setRefreshing(sourceId, false)
    }
  }

  /**
   * The secret can be entered again in place: it is missing (the stored one
   * was lost), or the panel refused it. Not while the store is merely
   * unreadable: the stored secret is still there and is read again.
   */
  const secretEntryOffered = (source: PlaylistSource): boolean => {
    if (!credentialsHydrated || secretStoreError) return false
    const failure = sourceErrors[source.id]?.kind
    if (source.type === 'xtream') return needsStoredSecret(source) || failure === 'missing-secret' || failure === 'auth'
    if (source.type === 'm3u_url') return needsStoredSecret(source) || failure === 'missing-secret'
    return false
  }

  const isConnected = (sourceId: string, type: string) => {
    if (type === 'xtream') return !!xtreamAuth[sourceId]
    return !sourceErrors[sourceId]
  }

  const statusText = (source: PlaylistSource, connected: boolean): string | null => {
    const failure = sourceErrors[source.id]
    if (failure?.retryAt != null) return 'yeniden bağlanıyor...'
    if (source.type === 'xtream' && !connected && !failure) return 'bağlanıyor...'
    return null
  }

  if (sources.length === 0) {
    return (
      <div className="text-center py-8 text-surface-500">
        {removalError && <p className="mb-2 text-xs text-red-400" role="alert">{removalError}</p>}
        <p>Henüz kaynak eklenmedi.</p>
        <p className="text-sm mt-1">Başlamak için bir Xtream Codes sunucusu veya M3U listesi ekleyin.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-surface-400 mb-1">Kaynaklarınız</h3>
      {removalError && (
        <p className="text-xs text-red-400" role="alert">{removalError}</p>
      )}
      {sources.map((source) => {
        const connected = isConnected(source.id, source.type)
        const isRefreshing = refreshingIds.has(source.id)
        const offerSecret = secretEntryOffered(source)

        return (
          <div key={source.id}>
            <div
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
                      {statusText(source, connected) && ` - ${statusText(source, connected)}`}
                    </p>
                    {(refreshError[source.id] ?? sourceErrors[source.id]?.message) && (
                      <p className="text-xs text-red-400 mt-0.5" role="alert">
                        {refreshError[source.id] ?? sourceErrors[source.id]?.message}
                      </p>
                    )}
                  </div>
                </div>
              </button>
              <div className="flex items-center gap-1">
                {offerSecret && editingSecret !== source.id && (
                  <Button variant="secondary" size="sm" onClick={() => setEditingSecret(source.id)}>
                    {source.type === 'xtream' ? 'Bilgileri Gir' : 'Adresi Gir'}
                  </Button>
                )}
                {source.type === 'm3u_file' && sourceErrors[source.id]?.kind === 'file' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isRefreshing}
                    onClick={() => {
                      void handleRefresh(source.id)
                    }}
                  >
                    Dosyayı Yeniden Seç
                  </Button>
                )}
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
            {editingSecret === source.id && <SourceSecretForm source={source} onDone={() => setEditingSecret(null)} />}
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
