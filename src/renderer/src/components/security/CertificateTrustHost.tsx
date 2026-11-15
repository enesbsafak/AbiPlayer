import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useStore } from '@/store'
import {
  onUntrustedCertificate,
  tlsListTrusted,
  tlsListUntrusted,
  tlsRevoke,
  tlsTrust,
  type UntrustedCertificateNotice
} from '@/services/platform'
import { toUserMessage } from '@/services/user-error'
import type { PlaylistSource } from '@/types/playlist'
import {
  DISMISS_QUIET_MS,
  describeProblems,
  endpointLabel,
  hostOf,
  noticeKey,
  noticeOwner,
  pinsToRevoke,
  type NoticeOwner
} from './certificate-trust'
import { notifyTrustChanged, onTrustPromptRequest, pendingSources, useTrustPrompts } from './trust-prompts'

function ownerName(owner: NoticeOwner): string | null {
  if (owner.kind === 'source') return owner.source.name
  if (owner.kind === 'playback') return owner.source?.name ?? null
  return null
}

function sourceIdOf(owner: NoticeOwner): string | undefined {
  if (owner.kind === 'source') return owner.source.id
  if (owner.kind === 'playback') return owner.source?.id
  return undefined
}

function formatDate(iso: string): string {
  const time = Date.parse(iso)
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('tr-TR') : iso
}

let startupNoticesRecovered = false

/** Queues a prompt for `notice` if it belongs to one of the user's sources. */
export function offerTrustPrompt(notice: UntrustedCertificateNotice, explicit: boolean, now = Date.now()): void {
  const state = useStore.getState()
  const owner = noticeOwner(notice, {
    sources: state.sources,
    pending: pendingSources(),
    playbackStreamUrl: state.currentPlayback?.streamUrl ?? null,
    playbackSourceId: state.currentPlayback?.target.sourceId ?? null,
    now
  })
  if (!owner) return
  // After "Vazgeç", background retries stay quiet for a while; a new press of
  // "Bağlan" (a later submission) or a request from settings asks again.
  const prompts = useTrustPrompts.getState()
  const quietSince = prompts.dismissedAt[noticeKey(notice)]
  const quiet =
    quietSince !== undefined &&
    (owner.kind === 'pending' ? quietSince >= owner.pending.submittedAt : now - quietSince < DISMISS_QUIET_MS)
  if (quiet && !explicit) return
  prompts.enqueue({ notice, owner })
}

/**
 * Asks the user about a refused certificate (F3-01) when it belongs to one of
 * their sources, pins it on consent and retries what failed. Also drops the
 * pins of a source that is removed. Mounted in the app shell.
 */
export function CertificateTrustHost() {
  const current = useTrustPrompts((s) => s.queue[0] ?? null)
  const resolveFirst = useTrustPrompts((s) => s.resolveFirst)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sources = useStore((s) => s.sources)
  const previousSources = useRef<PlaylistSource[]>(sources)

  useEffect(() => {
    const unsubscribe = onUntrustedCertificate((notice) => offerTrustPrompt(notice, false))
    const unsubscribePrompt = onTrustPromptRequest((notice) => offerTrustPrompt(notice, true))
    // Refusals from before the first mount (start-up auto-connect); once per
    // run, the shell remounts this host when it switches layouts.
    if (!startupNoticesRecovered) {
      startupNoticesRecovered = true
      void tlsListUntrusted().then((notices) => {
        for (const notice of [...notices].reverse()) offerTrustPrompt(notice, false)
      })
    }
    return () => {
      unsubscribe?.()
      unsubscribePrompt()
    }
  }, [])

  // Removing a source removes the trust given for it.
  useEffect(() => {
    const previous = previousSources.current
    previousSources.current = sources
    const removed = previous.filter((source) => !sources.some((next) => next.id === source.id))
    if (removed.length === 0) return
    void (async () => {
      const revoke = pinsToRevoke(removed, sources, await tlsListTrusted())
      if (revoke.length === 0) return
      await Promise.all(revoke.map((pin) => tlsRevoke(pin.host, pin.port).catch(() => false)))
      notifyTrustChanged()
    })()
  }, [sources])

  const handleCancel = useCallback(() => {
    setError(null)
    resolveFirst(true)
  }, [resolveFirst])

  const handleConfirm = useCallback(async () => {
    if (!current || busy) return
    const { notice, owner } = current
    setBusy(true)
    setError(null)
    try {
      await tlsTrust({
        host: notice.host,
        port: notice.port,
        fingerprint256: notice.fingerprint256,
        sourceId: sourceIdOf(owner)
      })
    } catch (cause) {
      setError(toUserMessage(cause, 'Sunucuya güvenilemedi.'))
      return
    } finally {
      setBusy(false)
    }
    resolveFirst(false)
    notifyTrustChanged()

    // Retry what failed, through the app's own actions.
    if (owner.kind === 'pending' && owner.pending.resubmit()) return
    const state = useStore.getState()
    // A playback from that host failed as well, whichever request reported it.
    if (state.currentPlayback && hostOf(state.currentPlayback.streamUrl) === notice.host) state.reloadPlayback()
    if (owner.kind !== 'pending') state.requestSourceReconnect()
  }, [current, busy, resolveFirst])

  if (!current) return null
  const { notice, owner } = current
  const name = ownerName(owner)

  return (
    <ConfirmDialog
      isOpen
      title={notice.changed ? 'Sunucunun sertifikası değişti' : 'Sunucunun sertifikası doğrulanamadı'}
      confirmLabel={busy ? 'Kaydediliyor…' : 'Bu sunucuya güven'}
      onConfirm={() => void handleConfirm()}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-3">
        <p className="flex items-start gap-2">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-400" aria-hidden />
          <span>
            <strong className="text-surface-50">{endpointLabel(notice.host, notice.port)}</strong>
            {name ? ` (${name})` : ''} kimliğini kanıtlayan güvenlik sertifikası doğrulanamadı.
          </span>
        </p>
        {notice.changed && (
          <p className="text-amber-300">
            Bu sunucu için daha önce güvendiğiniz sertifika değişti. Sağlayıcınız sertifikasını yenilemiş olabilir;
            ama bu, bağlantınıza birinin araya girdiği anlamına da gelebilir.
          </p>
        )}
        <ul className="list-disc pl-5">
          {describeProblems(notice).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>
          Güvenirseniz uygulama bu sunucuda yalnızca bu sertifikayı kabul eder; sertifika değişirse yeniden sorar.
          Bağlantı şifreli kalır, ama sunucunun gerçekten sağlayıcınıza ait olduğu doğrulanamaz: aynı ağdaki biri
          araya girerse kullanıcı adınızı ve şifrenizi görebilir. Bu sertifikayı beklemiyorsanız güvenmeyin.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-surface-950 p-3 text-xs">
          <dt className="text-surface-500">Parmak izi (SHA-256)</dt>
          <dd className="break-all font-mono text-surface-300">{notice.fingerprint256}</dd>
          <dt className="text-surface-500">Düzenleyen</dt>
          <dd className="break-all text-surface-300">{notice.issuer || '—'}</dd>
          <dt className="text-surface-500">Geçerlilik</dt>
          <dd className="text-surface-300">
            {formatDate(notice.validFrom)} – {formatDate(notice.validTo)}
          </dd>
        </dl>
        <p className="text-xs text-surface-500">Güvendiğiniz sunucuları Ayarlar &gt; Kaynaklar bölümünden kaldırabilirsiniz.</p>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    </ConfirmDialog>
  )
}
