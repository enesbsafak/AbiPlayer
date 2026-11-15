import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { ACTION, FieldError, SettingsGroup } from '@/components/settings/controls'
import { useStore } from '@/store'
import {
  onUntrustedCertificate,
  tlsListTrusted,
  tlsListUntrusted,
  tlsRevoke,
  type TrustedCertificateHost,
  type UntrustedCertificateNotice
} from '@/services/platform'
import { toUserMessage } from '@/services/user-error'
import { strings } from '@/strings'
import { describeProblems, endpointLabel, formatCertificateDate, hostOf, shortFingerprint } from './certificate-trust'
import { notifyTrustChanged, onTrustChanged, requestTrustPrompt } from './trust-prompts'

const text = strings.security.trusted

/**
 * Settings > Kaynaklar: servers the user trusted despite a certificate
 * problem, with revoke, and refused certificates of their sources that are
 * still waiting for an answer.
 */
export function TrustedCertificates() {
  const sources = useStore((s) => s.sources)
  const [trusted, setTrusted] = useState<TrustedCertificateHost[]>([])
  const [untrusted, setUntrusted] = useState<UntrustedCertificateNotice[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [nextTrusted, nextUntrusted] = await Promise.all([tlsListTrusted(), tlsListUntrusted()])
    setTrusted(nextTrusted)
    setUntrusted(nextUntrusted)
  }, [])

  useEffect(() => {
    void reload()
    const offChanged = onTrustChanged(() => void reload())
    const offNotice = onUntrustedCertificate(() => void reload())
    return () => {
      offChanged()
      offNotice?.()
    }
  }, [reload])

  const sourceHosts = new Set(sources.map((source) => hostOf(source.url)).filter(Boolean))
  const waiting = untrusted.filter((notice) => sourceHosts.has(notice.host))

  const revoke = async (pin: TrustedCertificateHost) => {
    setError(null)
    try {
      await tlsRevoke(pin.host, pin.port)
      notifyTrustChanged()
    } catch (cause) {
      setError(toUserMessage(cause, text.revokeFailed))
    }
  }

  if (trusted.length === 0 && waiting.length === 0) return null

  return (
    <SettingsGroup title={text.title}>
      <p className="-mt-1 text-sm text-surface-400">{text.hint}</p>

      {waiting.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={text.waitingList}>
          {waiting.map((notice) => (
            <li
              key={`${endpointLabel(notice.host, notice.port)}|${notice.fingerprint256}`}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-card bg-raised py-3 pl-4 pr-3"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sun text-ink">
                  <ShieldAlert size={18} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base font-bold">{endpointLabel(notice.host, notice.port)}</p>
                  <p className="text-sm text-surface-400">
                    {notice.changed ? text.changed : ''}
                    {describeProblems(notice).join(' ')}
                  </p>
                </div>
              </div>
              <button type="button" className={ACTION.secondary} onClick={() => requestTrustPrompt(notice)}>
                {text.review}
              </button>
            </li>
          ))}
        </ul>
      )}

      {trusted.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={text.trustedList}>
          {trusted.map((pin) => (
            <li
              key={endpointLabel(pin.host, pin.port)}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-card bg-raised py-3 pl-4 pr-3"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-mint text-ink">
                  <ShieldCheck size={18} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base font-bold">{endpointLabel(pin.host, pin.port)}</p>
                  <p className="truncate font-mono text-[13px] text-surface-400" title={pin.fingerprint256}>
                    {shortFingerprint(pin.fingerprint256)}…
                  </p>
                  <p className="text-sm text-surface-400">
                    {text.validity(formatCertificateDate(pin.validFrom), formatCertificateDate(pin.validTo))}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={ACTION.secondary}
                onClick={() => void revoke(pin)}
                aria-label={text.revokeFor(endpointLabel(pin.host, pin.port))}
              >
                {text.revoke}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <FieldError>{error}</FieldError>}
    </SettingsGroup>
  )
}
