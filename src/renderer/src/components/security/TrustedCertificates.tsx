import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
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
    <section
      className="rounded-lg border border-surface-800 bg-surface-900 p-5"
      aria-labelledby="trusted-certificates-title"
    >
      <h3 id="trusted-certificates-title" className="font-semibold">
        {text.title}
      </h3>
      <p className="mt-1 text-xs text-surface-400">
        {text.hint}
      </p>

      {waiting.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2" aria-label={text.waitingList}>
          {waiting.map((notice) => (
            <li
              key={`${endpointLabel(notice.host, notice.port)}|${notice.fingerprint256}`}
              className="flex items-center justify-between gap-3 rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2"
            >
              <div className="flex min-w-0 items-start gap-2">
                <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-400" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{endpointLabel(notice.host, notice.port)}</p>
                  <p className="text-xs text-surface-400">
                    {notice.changed ? text.changed : ''}
                    {describeProblems(notice).join(' ')}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => requestTrustPrompt(notice)}>
                {text.review}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {trusted.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2" aria-label={text.trustedList}>
          {trusted.map((pin) => (
            <li
              key={endpointLabel(pin.host, pin.port)}
              className="flex items-center justify-between gap-3 rounded-md border border-surface-800 px-3 py-2"
            >
              <div className="flex min-w-0 items-start gap-2">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{endpointLabel(pin.host, pin.port)}</p>
                  <p className="truncate font-mono text-xs text-surface-500" title={pin.fingerprint256}>
                    {shortFingerprint(pin.fingerprint256)}…
                  </p>
                  <p className="text-xs text-surface-500">
                    {text.validity(formatCertificateDate(pin.validFrom), formatCertificateDate(pin.validTo))}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void revoke(pin)}
                aria-label={text.revokeFor(endpointLabel(pin.host, pin.port))}
              >
                {text.revoke}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
