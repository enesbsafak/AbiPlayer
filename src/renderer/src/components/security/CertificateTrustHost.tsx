import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FieldError } from '@/components/settings/controls'
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
import { reloadAfterCertificateTrust } from '@/catalog/cache-lifecycle'
import type { PlaylistSource } from '@/types/playlist'
import { strings } from '@/strings'
import {
  DISMISS_QUIET_MS,
  describeProblems,
  endpointLabel,
  formatCertificateDate,
  hostOf,
  noticeKey,
  noticeOwner,
  pinsToRevoke,
  type NoticeOwner
} from './certificate-trust'
import { notifyTrustChanged, onTrustPromptRequest, pendingSources, useTrustPrompts } from './trust-prompts'

const text = strings.security.trust

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
      setError(toUserMessage(cause, text.trustFailed))
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
    // A list that failed after the sign-in worked is not retried by the
    // reconnect: the source's catalog is loaded again as well.
    const sourceId = sourceIdOf(owner)
    if (owner.kind !== 'pending' && sourceId) {
      void reloadAfterCertificateTrust(sourceId).catch((cause: unknown) => {
        console.warn('[tls] reloading the catalog after trust failed:', toUserMessage(cause))
      })
    }
  }, [current, busy, resolveFirst])

  if (!current) return null
  const { notice, owner } = current
  const name = ownerName(owner)

  return (
    <ConfirmDialog
      isOpen
      title={notice.changed ? text.changedTitle : text.unverifiedTitle}
      confirmLabel={busy ? strings.common.saving : text.confirm}
      onConfirm={() => void handleConfirm()}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-4 text-[15px] text-surface-300">
        {/* What happened, then why it matters, then the facts to compare. */}
        <p className="flex items-start gap-3">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sun text-ink">
            <ShieldAlert size={18} />
          </span>
          <span className="pt-1.5">
            <strong className="text-white">{endpointLabel(notice.host, notice.port)}</strong>
            {name ? text.ownerSuffix(name) : ''}
            {text.unverifiedBody}
          </span>
        </p>
        {notice.changed && (
          <p className="flex items-start gap-3 font-medium text-white">
            <span aria-hidden="true" className="mt-[7px] size-2.5 shrink-0 rounded-full bg-coral" />
            <span>{text.changedWarning}</span>
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {describeProblems(notice).map((line) => (
            <li key={line} className="flex items-start gap-3">
              <span aria-hidden="true" className="mt-[8px] size-1.5 shrink-0 rounded-full bg-surface-500" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p>{text.explanation}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-2xl bg-deep p-4 text-[13px]">
          <dt className="text-surface-500">{text.fingerprint}</dt>
          <dd className="break-all font-mono text-surface-300">{notice.fingerprint256}</dd>
          <dt className="text-surface-500">{text.issuer}</dt>
          <dd className="break-all text-surface-300">{notice.issuer || '—'}</dd>
          <dt className="text-surface-500">{text.validity}</dt>
          <dd className="text-surface-300">
            {formatCertificateDate(notice.validFrom)} – {formatCertificateDate(notice.validTo)}
          </dd>
        </dl>
        <p className="text-sm text-surface-400">{text.manageHint}</p>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </ConfirmDialog>
  )
}
