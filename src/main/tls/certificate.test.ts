// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { certificateProblems, hasUnbundleableProblem, isSelfSigned, normalizeFingerprint, readCertificate } from './certificate'
import { generateSelfSignedCertificate } from './testing/self-signed'

const DAY = 86_400_000
const NOW = Date.now()

describe('readCertificate', () => {
  it('reads fingerprint, names and validity of a PEM certificate', () => {
    const generated = generateSelfSignedCertificate({ commonName: 'panel.example', altNames: ['panel.example'] })
    const details = readCertificate(generated.cert)
    expect(details?.fingerprint256).toBe(generated.fingerprint256)
    expect(details?.subject).toBe('CN=panel.example')
    expect(details?.issuer).toBe('CN=panel.example')
    expect(Date.parse(details!.validTo)).toBeGreaterThan(NOW)
  })

  it('returns null for anything else', () => {
    expect(readCertificate('not a certificate')).toBeNull()
  })
})

describe('normalizeFingerprint', () => {
  it('accepts either case, with or without colons', () => {
    const upper = 'AB:'.repeat(31) + 'AB'
    expect(normalizeFingerprint('ab'.repeat(32))).toBe(upper)
    expect(normalizeFingerprint(upper.toLowerCase())).toBe(upper)
    expect(normalizeFingerprint('AB:CD')).toBeNull()
  })
})

describe('certificateProblems', () => {
  it('names a self-signed certificate as an authority problem only', () => {
    const { cert } = generateSelfSignedCertificate({ altNames: ['panel.example'] })
    expect(isSelfSigned(cert)).toBe(true)
    expect(certificateProblems(cert, 'panel.example', NOW)).toEqual(['authority'])
    expect(hasUnbundleableProblem(cert, 'panel.example', NOW)).toBe(false)
  })

  it('finds an expired certificate and a name mismatch, including IP hosts', () => {
    const expired = generateSelfSignedCertificate({
      altNames: ['127.0.0.1'],
      notBefore: new Date(NOW - 40 * DAY),
      notAfter: new Date(NOW - 10 * DAY)
    })
    expect(certificateProblems(expired.cert, '127.0.0.1', NOW)).toEqual(['authority', 'expired'])
    expect(hasUnbundleableProblem(expired.cert, '127.0.0.1', NOW)).toBe(true)

    const elsewhere = generateSelfSignedCertificate({ altNames: ['other.example'] })
    expect(certificateProblems(elsewhere.cert, 'panel.example', NOW)).toEqual(['authority', 'name-mismatch'])
    expect(certificateProblems(elsewhere.cert, '10.0.0.1', NOW)).toContain('name-mismatch')
  })

  it('takes the authority verdict from the verifier error', () => {
    const { cert } = generateSelfSignedCertificate({ altNames: ['panel.example'] })
    expect(certificateProblems(cert, 'panel.example', NOW, 'net::ERR_CERT_AUTHORITY_INVALID')).toEqual(['authority'])
  })
})
