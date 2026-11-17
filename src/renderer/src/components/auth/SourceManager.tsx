import { useEffect, useState } from 'react'
import { Trash2, RefreshCw, Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ACTION, FieldError, SettingsGroup } from '@/components/settings/controls'
import { forgetXtreamRequests, xtreamApi } from '@/services/xtream-api'
import { secureCredentialService } from '@/services/secure-credentials'
import { pickAndReadFile } from '@/services/platform'
import { toUserMessage } from '@/services/user-error'
import { catalog } from '@/catalog/catalog-store'
import { reloadSourceCatalog } from '@/catalog/cache-lifecycle'
import { ingestDropped, ingestM3uText } from '@/catalog/worker-ingest'
import { keepsSecretInStore, needsStoredSecret } from '@/store/auth-slice'
import { addonHost } from '@/addons/address'
import { refreshAddonSource } from '@/addons/connect'
import { fetchAddonManifest } from '@/addons/client'
import type { PlaylistSource } from '@/types/playlist'
import { strings } from '@/strings'
import { SourceSecretForm } from './SourceSecretForm'
import { addonOfferLabels, describeAddonOffer, notChoosableReason, placeAddonError } from './addon-entry'

const text = strings.sources.manager

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function sourceStillExists(sourceId: string): boolean {
  return useStore.getState().sources.some((source) => source.id === sourceId)
}

const SOURCE_TYPE_LABELS: Record<PlaylistSource['type'], string> = strings.sources.typeLabels

/** The source was removed while its add-on's manifest was being fetched. */
class SourceGone extends Error {}

/** `onEditingChange`: a source's sign-in form opened or closed (it then holds the primary action). */
export function SourceManager({ onEditingChange }: { onEditingChange?: (editing: boolean) => void } = {}) {
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
  const addonSessions = useStore((s) => s.addonSessions)
  const setAddonSession = useStore((s) => s.setAddonSession)
  const addonsEnabled = useStore((s) => s.settings.addonSourcesEnabled)
  const [removalError, setRemovalError] = useState<string | null>(null)

  // A set, not one id: two refreshes can overlap, and the first to finish
  // used to clear the spinner of the other.
  const [refreshingIds, setRefreshingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [refreshError, setRefreshError] = useState<Record<string, string>>({})
  const [pendingRemoval, setPendingRemoval] = useState<PlaylistSource | null>(null)
  // Sources whose secret is being entered again, in place (K3).
  const [editingSecret, setEditingSecret] = useState<string | null>(null)
  useEffect(() => {
    onEditingChange?.(editingSecret !== null)
  }, [editingSecret, onEditingChange])
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
    if (keepsSecretInStore(source)) {
      try {
        await secureCredentialService.delete(source.id)
      } catch (err) {
        // The source still goes, as asked; the user learns that its stored
        // sign-in could not be wiped instead of it failing silently.
        setRemovalError(text.removedButSecretKept(source.name, toUserMessage(err)))
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
        if (!creds) throw new Error(text.noCredentials)
        const auth = await xtreamApi.authenticate(creds)
        if (auth.user_info.auth !== 1) {
          throw new Error(strings.sources.validation.authFailed)
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
          { name: strings.sources.m3u.fileFilter, extensions: ['m3u', 'm3u8', 'txt'] }
        ])
        if (!result) return
        if (!sourceStillExists(sourceId)) return
        // Parsed in the worker and cached under the file picked now.
        const outcome = await ingestM3uText(sourceId, result.content, result.path)
        if (!sourceStillExists(sourceId)) return
        if (ingestDropped(outcome)) throw new Error(text.reloadedDuringLoad)
        // The file may have been picked from a new place: the next start reads it from there.
        if (result.path !== source.filePath) updateSource(sourceId, { filePath: result.path })
        setSourceError(sourceId, null)
      } else if (source.type === 'addon' && source.url) {
        // The manifest again: what the add-on provides now, and its catalogues
        // as categories. A failure says so and keeps the stored summary.
        const { session } = await refreshAddonSource(
          source,
          {
            fetchManifest: async (base, options) => {
              const summary = await fetchAddonManifest(base, options)
              if (!sourceStillExists(sourceId)) throw new SourceGone()
              return summary
            },
            updateSummary: (id, summary) => updateSource(id, { addon: summary })
          },
          { strict: true }
        )
        setAddonSession(sourceId, session)
      }
    } catch (err) {
      if (err instanceof SourceGone) return
      const message =
        source.type === 'addon' ? placeAddonError(err, text.refreshFailed).message : toUserMessage(err, text.refreshFailed)
      setRefreshError((prev) => ({ ...prev, [sourceId]: message }))
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
    // An add-on that refused its address (a personal key changed, say) gets
    // a new one in place, keeping its id.
    if (source.type === 'addon') {
      const refused = refreshError[source.id] === strings.sources.validation.addonRefused
      return addonsEnabled && (needsStoredSecret(source) || failure === 'missing-secret' || refused)
    }
    return false
  }

  /** Refreshing applies: an add-on's manifest is fetched again (it needs its address and the setting on). */
  const refreshOffered = (source: PlaylistSource): boolean => source.type !== 'addon' || (addonsEnabled && !!source.url)

  const isConnected = (sourceId: string, type: string) => {
    if (type === 'xtream') return !!xtreamAuth[sourceId]
    if (type === 'addon') return !!addonSessions[sourceId]
    return !sourceErrors[sourceId]
  }

  const statusText = (source: PlaylistSource, connected: boolean): string | null => {
    const failure = sourceErrors[source.id]
    if (failure?.retryAt != null) return text.reconnecting
    if ((source.type === 'xtream' || source.type === 'addon') && !connected && !failure) return text.connecting
    if (source.type === 'addon' && addonSessions[source.id]?.manifestFresh === false) return text.addonUnreachable
    return null
  }

  const confirmDialog = (
    <ConfirmDialog
      isOpen={pendingRemoval !== null}
      title={text.removeConfirmTitle}
      confirmLabel={strings.common.delete}
      destructive
      onCancel={() => setPendingRemoval(null)}
      onConfirm={() => {
        const source = pendingRemoval
        setPendingRemoval(null)
        if (source) void handleRemove(source)
      }}
    >
      <p>
        <span className="font-medium text-surface-100">{pendingRemoval?.name}</span>
        {text.removeConfirmBody}
      </p>
    </ConfirmDialog>
  )

  // No sources: the add step below says what to do. A failed wipe of the
  // last source's sign-in is still reported.
  if (sources.length === 0) {
    return removalError ? <FieldError>{removalError}</FieldError> : null
  }

  return (
    <SettingsGroup title={text.heading} aside={text.count(sources.length)}>
      {removalError && <FieldError>{removalError}</FieldError>}
      <ul className="flex flex-col gap-2">
        {sources.map((source) => {
          const isActive = source.id === activeSourceId
          const connected = isConnected(source.id, source.type)
          const isRefreshing = refreshingIds.has(source.id)
          const offerSecret = secretEntryOffered(source)
          const status = statusText(source, connected)
          const problem = refreshError[source.id] ?? sourceErrors[source.id]?.message
          const notChoosable = notChoosableReason(source, addonsEnabled)
          const host = source.type === 'addon' ? addonHost(source.url) : null
          const labels = source.type === 'addon' && source.addon ? addonOfferLabels(describeAddonOffer(source.addon)) : []

          const rowClass = `flex min-h-[60px] min-w-[min(100%,260px)] flex-1 items-center gap-4 rounded-[14px] px-4 py-2.5 text-left transition-colors ${
            isActive ? 'bg-sky text-ink' : 'text-white'
          }`
          const rowContent = (
            <>
              <span
                aria-hidden="true"
                className={`flex size-4 shrink-0 items-center justify-center rounded-full ${isActive ? 'bg-ink' : ''}`}
              >
                <span className={`size-2.5 rounded-full ${connected ? 'bg-mint' : 'bg-surface-600'}`} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold">{source.name}</span>
                <span className={`block truncate text-sm ${isActive ? 'text-ink/75' : 'text-surface-400'}`}>
                  {SOURCE_TYPE_LABELS[source.type]}
                  {host && ` · ${host}`}
                  {' · '}
                  {connected ? text.connected : text.disconnected}
                  {status && text.statusSuffix(status)}
                </span>
                {labels.length > 0 && (
                  <span role="list" aria-label={text.addonLabelsName} className="mt-1.5 flex flex-wrap gap-1.5">
                    {labels.map((label) => (
                      <span
                        key={label}
                        role="listitem"
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          isActive ? 'bg-ink/15 text-ink' : 'bg-ground text-surface-300'
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                  </span>
                )}
                {notChoosable && (
                  <span className={`mt-1.5 block text-sm ${isActive ? 'text-ink/75' : 'text-surface-400'}`}>{notChoosable}</span>
                )}
              </span>
              {(!notChoosable || isActive) && (
                <span className={`shrink-0 text-sm max-sm:hidden ${isActive ? 'font-bold' : 'font-medium text-surface-500'}`}>
                  {isActive ? text.inUse : text.useThis}
                </span>
              )}
            </>
          )

          return (
            <li key={source.id} className="flex min-w-0 flex-col rounded-card bg-raised p-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {/* Choosing the source in use: the one in use is filled with sky. A
                    source that cannot be in use (a stream-only add-on) is no choice
                    at all and says why. */}
                {notChoosable ? (
                  <div className={rowClass} aria-current={isActive ? 'true' : undefined}>
                    {rowContent}
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`${rowClass} ${isActive ? '' : 'hover:bg-surface-800'}`}
                    onClick={() => setActiveSource(source.id)}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    {rowContent}
                  </button>
                )}
                <div className="flex shrink-0 items-center gap-2 pr-1">
                  {offerSecret && editingSecret !== source.id && (
                    <button type="button" className={ACTION.secondary} onClick={() => setEditingSecret(source.id)}>
                      {source.type === 'xtream' ? text.enterCredentials : text.enterAddress}
                    </button>
                  )}
                  {source.type === 'm3u_file' && sourceErrors[source.id]?.kind === 'file' && (
                    <button
                      type="button"
                      className={ACTION.secondary}
                      disabled={isRefreshing}
                      onClick={() => {
                        void handleRefresh(source.id)
                      }}
                    >
                      {text.repickFile}
                    </button>
                  )}
                  {refreshOffered(source) && (
                    <button
                      type="button"
                      className={ACTION.icon}
                      disabled={isRefreshing}
                      onClick={() => {
                        void handleRefresh(source.id)
                      }}
                      aria-label={source.type === 'addon' ? text.refreshAddon(source.name) : text.refresh(source.name)}
                      title={strings.common.refresh}
                    >
                      {isRefreshing ? (
                        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw size={18} aria-hidden="true" />
                      )}
                    </button>
                  )}
                  {/* Removing is apart from the rest, in coral, and asks first. */}
                  <span aria-hidden="true" className="mx-1 h-6 w-0.5 rounded-full bg-ground" />
                  <button
                    type="button"
                    className={ACTION.iconDanger}
                    onClick={() => setPendingRemoval(source)}
                    aria-label={text.remove(source.name)}
                    title={strings.common.delete}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {problem && (
                <div className="px-4 pb-2 pt-2.5">
                  <FieldError>{problem}</FieldError>
                </div>
              )}
              {editingSecret === source.id && (
                <SourceSecretForm
                  source={source}
                  onDone={(saved) => {
                    setEditingSecret(null)
                    // What the old secret's refusal said no longer holds.
                    if (saved) setRefreshError((prev) => withoutKey(prev, source.id))
                  }}
                />
              )}
            </li>
          )
        })}
      </ul>
      {confirmDialog}
    </SettingsGroup>
  )
}
