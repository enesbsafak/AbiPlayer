import { X509Certificate } from 'crypto'
import { isIP } from 'net'
import type { CertificateProblem, CertificateSummary } from '../../shared/ipc/contract'

export interface CertificateDetails extends CertificateSummary {
  /** PEM of the leaf certificate. */
  pem: string
}

function parse(input: string | Buffer): X509Certificate | null {
  try {
    return new X509Certificate(input)
  } catch {
    return null
  }
}

function distinguishedName(value: string): string {
  return value
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
}

function isoDate(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : value
}

/** Fingerprint in the one format used everywhere: `AA:BB:…`, upper case. */
export function normalizeFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = value.replace(/:/g, '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null
  return hex.toUpperCase().match(/.{2}/g)!.join(':')
}

/** Reads a PEM or DER certificate; null when it is not one. */
export function readCertificate(input: string | Buffer): CertificateDetails | null {
  const certificate = parse(input)
  if (!certificate) return null
  return {
    fingerprint256: normalizeFingerprint(certificate.fingerprint256)!,
    subject: distinguishedName(certificate.subject),
    issuer: distinguishedName(certificate.issuer),
    validFrom: isoDate(certificate.validFrom),
    validTo: isoDate(certificate.validTo),
    pem: certificate.toString()
  }
}

/** Signed by its own key: no certificate authority vouches for it. */
export function isSelfSigned(pem: string): boolean {
  const certificate = parse(pem)
  if (!certificate) return false
  try {
    return certificate.checkIssued(certificate) && certificate.verify(certificate.publicKey)
  } catch {
    return false
  }
}

// Chromium's net::ERR_CERT_* names and Node/OpenSSL verification codes that
// mean "no trusted authority vouches for this chain".
const AUTHORITY_ERROR =
  /AUTHORITY_INVALID|SELF_SIGNED|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY_LEAF|UNTRUSTED|CERT_UNTRUSTED|INVALID_CA/i

/**
 * What is wrong with `pem` for `host` at `now`. The date and name checks are
 * made here from the certificate itself; whether a trusted authority signed it
 * can only come from the verifier, through `verificationError`.
 */
export function certificateProblems(
  pem: string,
  host: string,
  now: number,
  verificationError = ''
): CertificateProblem[] {
  const certificate = parse(pem)
  if (!certificate) return ['other']
  const problems: CertificateProblem[] = []
  if (AUTHORITY_ERROR.test(verificationError) || isSelfSigned(pem)) problems.push('authority')
  const from = Date.parse(certificate.validFrom)
  const to = Date.parse(certificate.validTo)
  if (Number.isFinite(to) && now > to) problems.push('expired')
  if (Number.isFinite(from) && now < from) problems.push('not-yet-valid')
  const matches = isIP(host) ? certificate.checkIP(host) : certificate.checkHost(host)
  if (!matches) problems.push('name-mismatch')
  if (problems.length === 0 && verificationError) problems.push('other')
  return problems
}

/**
 * Problems a CA bundle cannot fix: putting the certificate in the trust list
 * makes its issuer trusted, but a verifier still rejects an expired or
 * misnamed certificate.
 */
export function hasUnbundleableProblem(pem: string, host: string, now: number): boolean {
  if (!isSelfSigned(pem)) return true
  return certificateProblems(pem, host, now).some((problem) => problem !== 'authority')
}
