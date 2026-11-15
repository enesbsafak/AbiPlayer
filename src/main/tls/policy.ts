import type {
  CertificateFailureContext,
  CertificateTrustRequest,
  TrustedCertificateHost,
  UntrustedCertificateNotice
} from '../../shared/ipc/contract'
import {
  certificateProblems,
  hasUnbundleableProblem,
  normalizeFingerprint,
  readCertificate,
  type CertificateDetails
} from './certificate'
import { endpointKey, isNeverRelaxableHost, normalizeHost, normalizePort, tlsEndpointOf, type TlsEndpoint } from './hosts'
import type { CertificateProbe } from './probe'
import type { StoredPin, TrustStore } from './trust-store'
import { mainStrings } from '../../shared/main-strings'

/*
 * TLS policy (plan item F3-01, decision K2).
 *
 * Verification is strict everywhere. A certificate that fails is recorded and
 * reported to the renderer, which asks the user only when the host is one of
 * their sources. A host the user trusts is pinned to the exact certificate
 * seen (host, port, SHA-256); anything else presented there fails again and
 * is reported as a changed certificate. GitHub (updates) and TMDB (API key)
 * hosts can never be trusted.
 *
 * Chromium: the renderer's requests reach `handleCertificateError` through
 * app 'certificate-error', which Chromium raises per request. The verdict of
 * `setCertificateVerifyProc` would be cached by the network service (results
 * are kept per certificate and host, failures included, and nothing Electron
 * exposes clears that cache), so trusting or revoking would only take effect
 * after a restart. A revoke also closes pooled connections, which would
 * otherwise keep serving the host without a new handshake.
 *
 * mpv and ffmpeg cannot use Chromium's decisions; each load gets its own
 * options (see `mpvLoadOptions` and `ffmpegArgs`). Residual risks:
 * - A pinned certificate that is expired, misnamed or not self-signed cannot
 *   be verified from a CA file, so such a load runs with verification off
 *   after main checked that the host presents the pinned certificate. An
 *   attacker who lets that check through and intercepts the player's own
 *   connection right after, or any host the stream redirects to, is not
 *   detected.
 * - ffmpeg's HLS demuxer does not pass TLS options to segment requests, so
 *   ffprobe/ffmpeg verify the playlist but not the segments (mpv's libcurl
 *   backend verifies both).
 * - A redirect from a verified host to a host with a bad certificate fails
 *   in the player without a prompt: only the first host is inspected.
 */

export const NOTICE_THROTTLE_MS = 2000
export const PROBE_CACHE_MS = 10 * 60_000
const MAX_RECENT_FAILURES = 50

export const NEVER_RELAXABLE_MESSAGE = mainStrings.tls.neverRelaxable
export const UNKNOWN_FAILURE_MESSAGE = mainStrings.tls.nothingToTrust
export const CERTIFICATE_CHANGED_MESSAGE = mainStrings.tls.changed

/** A load refused by the policy; the message is Turkish and safe to show. */
export class CertificateTrustError extends Error {
  readonly kind = 'certificate'

  constructor(message: string) {
    super(message)
    this.name = 'CertificateTrustError'
  }
}

interface RecordedFailure {
  notice: UntrustedCertificateNotice
  certificate: CertificateDetails
}

export interface TlsPolicyDeps {
  store: TrustStore
  /** CA file holding the system roots plus `extraPems`. */
  caFile: (extraPems?: readonly string[]) => Promise<string>
  probe: CertificateProbe
  notify: (notice: UntrustedCertificateNotice) => void
  /** Called after a pin is removed, so pooled connections do not outlive it; awaited. */
  onRevoked?: () => Promise<void> | void
  now?: () => number
}

export type MpvTlsFileOptions = Record<string, string>

export class TlsPolicy {
  private readonly failures = new Map<string, RecordedFailure>()
  private readonly notifiedAt = new Map<string, number>()
  private readonly probed = new Map<string, number>()
  private readonly probing = new Map<string, Promise<void>>()

  constructor(private readonly deps: TlsPolicyDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  // ---------------------------------------------------------------------------
  // Chromium

  /** True to let the request through. Records and reports what it refuses. */
  handleCertificateError(input: { url: string; error: string; certificate: string | Buffer }): boolean {
    const endpoint = tlsEndpointOf(input.url)
    if (!endpoint || isNeverRelaxableHost(endpoint.host)) return false
    const certificate = readCertificate(input.certificate)
    if (!certificate) return false
    const pin = this.deps.store.get(endpoint)
    if (pin && pin.fingerprint256 === certificate.fingerprint256) return true
    this.recordFailure(endpoint, certificate, input.error, 'network', pin)
    return false
  }

  // ---------------------------------------------------------------------------
  // Renderer-facing

  listTrusted(): TrustedCertificateHost[] {
    return this.deps.store.list().map(({ pem: _pem, ...summary }) => summary)
  }

  listUntrusted(): UntrustedCertificateNotice[] {
    return [...this.failures.values()].map((failure) => failure.notice).sort((a, b) => b.seenAt - a.seenAt)
  }

  /**
   * Pins the certificate main last saw for this host and port. Only a failure
   * main recorded itself can be trusted: the renderer names it, it cannot
   * supply a certificate or fingerprint of its own.
   */
  async trust(request: CertificateTrustRequest): Promise<TrustedCertificateHost> {
    const host = normalizeHost(request?.host)
    const port = normalizePort(request?.port)
    const fingerprint = normalizeFingerprint(request?.fingerprint256)
    if (!host || !port || !fingerprint) throw new Error(mainStrings.invalid.trustRequest)
    if (isNeverRelaxableHost(host)) throw new CertificateTrustError(NEVER_RELAXABLE_MESSAGE)

    const endpoint = { host, port }
    const failure = this.failures.get(endpointKey(endpoint))
    if (!failure || failure.certificate.fingerprint256 !== fingerprint) {
      throw new CertificateTrustError(UNKNOWN_FAILURE_MESSAGE)
    }

    const existing = this.deps.store.get(endpoint)
    const sourceId = typeof request.sourceId === 'string' && request.sourceId ? request.sourceId : null
    const sourceIds = new Set(existing?.fingerprint256 === fingerprint ? existing.sourceIds : [])
    if (sourceId) sourceIds.add(sourceId)

    const pin: StoredPin = {
      host,
      port,
      fingerprint256: fingerprint,
      subject: failure.certificate.subject,
      issuer: failure.certificate.issuer,
      validFrom: failure.certificate.validFrom,
      validTo: failure.certificate.validTo,
      problems: failure.notice.problems,
      sourceIds: [...sourceIds],
      trustedAt: this.now(),
      pem: failure.certificate.pem
    }
    await this.deps.store.put(pin)
    this.forget(endpoint)
    const { pem: _pem, ...summary } = pin
    return summary
  }

  async revoke(hostValue: unknown, portValue: unknown): Promise<boolean> {
    const host = normalizeHost(hostValue)
    const port = normalizePort(portValue)
    if (!host || !port) throw new Error(mainStrings.invalid.serverAddress)
    const endpoint = { host, port }
    const removed = await this.deps.store.remove(endpoint)
    this.forget(endpoint)
    if (removed) await this.deps.onRevoked?.()
    return removed
  }

  // ---------------------------------------------------------------------------
  // mpv and ffmpeg

  /**
   * Per-load mpv options for `url`, applied as `loadfile` file options so one
   * trusted host never relaxes another load. Rejects with
   * `CertificateTrustError` when a pinned host now presents another
   * certificate.
   */
  async mpvLoadOptions(url: string): Promise<MpvTlsFileOptions> {
    const plan = await this.planLoad(url, 'playback')
    if (plan.kind === 'none') return {}
    if (plan.kind === 'relaxed') return { 'tls-verify': 'no' }
    return plan.caFile ? { 'tls-verify': 'yes', 'tls-ca-file': plan.caFile } : { 'tls-verify': 'yes' }
  }

  /** TLS arguments for ffprobe/ffmpeg, placed before the input. */
  async ffmpegArgs(url: string): Promise<string[]> {
    const plan = await this.planLoad(url, 'media')
    if (plan.kind === 'none') return []
    if (plan.kind === 'relaxed') return ['-tls_verify', '0']
    // GnuTLS reads the system store only when no file is given; always give one.
    return ['-tls_verify', '1', '-ca_file', plan.caFile ?? (await this.deps.caFile())]
  }

  private async planLoad(
    url: string,
    context: CertificateFailureContext
  ): Promise<{ kind: 'none' } | { kind: 'relaxed' } | { kind: 'verify'; caFile: string | null }> {
    const endpoint = tlsEndpointOf(url)
    if (!endpoint) return { kind: 'none' }
    const pin = isNeverRelaxableHost(endpoint.host) ? null : this.deps.store.get(endpoint)

    if (!pin) {
      // The player verifies against the system store; a failure there says
      // nothing about why, so main looks at the certificate itself, off the
      // load's critical path, and reports it like Chromium would.
      void this.inspect(endpoint, context)
      return { kind: 'verify', caFile: null }
    }

    if (!hasUnbundleableProblem(pin.pem, endpoint.host, this.now())) {
      // Self-signed and otherwise valid: the player verifies it from a CA file
      // holding exactly this certificate, so a different one fails there.
      void this.inspect(endpoint, context)
      return { kind: 'verify', caFile: await this.deps.caFile([pin.pem]) }
    }

    const probe = await this.deps.probe(endpoint)
    if (!probe.certificate) {
      // Unreachable or no handshake: never relax without having seen the pin;
      // the player fails on its own.
      return { kind: 'verify', caFile: await this.deps.caFile([pin.pem]) }
    }
    if (probe.certificate.fingerprint256 === pin.fingerprint256) return { kind: 'relaxed' }
    if (probe.authorized) return { kind: 'verify', caFile: null }
    this.recordFailure(endpoint, probe.certificate, probe.error ?? '', context, pin)
    throw new CertificateTrustError(CERTIFICATE_CHANGED_MESSAGE)
  }

  /** Looks at the certificate of `endpoint` at most once per PROBE_CACHE_MS. */
  private inspect(endpoint: TlsEndpoint, context: CertificateFailureContext): Promise<void> {
    const key = endpointKey(endpoint)
    const running = this.probing.get(key)
    if (running) return running
    const last = this.probed.get(key)
    if (last !== undefined && this.now() - last < PROBE_CACHE_MS) return Promise.resolve()

    const run = this.deps
      .probe(endpoint)
      .then((result) => {
        this.probed.set(key, this.now())
        if (result.authorized || !result.certificate) return
        const pin = this.deps.store.get(endpoint)
        if (pin && pin.fingerprint256 === result.certificate.fingerprint256) return
        this.recordFailure(endpoint, result.certificate, result.error ?? '', context, pin)
      })
      .catch(() => undefined)
      .finally(() => this.probing.delete(key))
    this.probing.set(key, run)
    return run
  }

  private forget(endpoint: TlsEndpoint): void {
    const key = endpointKey(endpoint)
    this.failures.delete(key)
    this.probed.delete(key)
    for (const noticeKey of [...this.notifiedAt.keys()]) {
      if (noticeKey.startsWith(`${key}|`)) this.notifiedAt.delete(noticeKey)
    }
  }

  private recordFailure(
    endpoint: TlsEndpoint,
    certificate: CertificateDetails,
    error: string,
    context: CertificateFailureContext,
    pin: StoredPin | null
  ): void {
    if (isNeverRelaxableHost(endpoint.host)) return
    const now = this.now()
    const key = endpointKey(endpoint)
    const notice: UntrustedCertificateNotice = {
      host: endpoint.host,
      port: endpoint.port,
      fingerprint256: certificate.fingerprint256,
      subject: certificate.subject,
      issuer: certificate.issuer,
      validFrom: certificate.validFrom,
      validTo: certificate.validTo,
      problems: certificateProblems(certificate.pem, endpoint.host, now, error),
      error,
      context,
      changed: pin !== null && pin.fingerprint256 !== certificate.fingerprint256,
      seenAt: now
    }
    this.failures.delete(key)
    this.failures.set(key, { notice, certificate })
    while (this.failures.size > MAX_RECENT_FAILURES) {
      this.failures.delete(this.failures.keys().next().value as string)
    }

    // A page of channel logos on one bad host fails dozens of requests at
    // once; one notice per certificate per moment is enough.
    const noticeKey = `${key}|${certificate.fingerprint256}`
    const last = this.notifiedAt.get(noticeKey)
    if (last !== undefined && now - last < NOTICE_THROTTLE_MS) return
    this.notifiedAt.set(noticeKey, now)
    this.deps.notify(notice)
  }
}
