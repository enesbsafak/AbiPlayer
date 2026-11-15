// @vitest-environment node
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UntrustedCertificateNotice } from '../../shared/ipc/contract'
import { readCertificate } from './certificate'
import { CertificateTrustError, NOTICE_THROTTLE_MS, TlsPolicy } from './policy'
import type { ProbeResult } from './probe'
import { generateSelfSignedCertificate, type GeneratedCertificate } from './testing/self-signed'
import { TrustStore } from './trust-store'

const DAY = 86_400_000
const SOURCE = 'https://panel.example:8443'
const ENDPOINT = { host: 'panel.example', port: 8443 }

let dir: string
let clock: number
let notices: UntrustedCertificateNotice[]
let probeResult: ProbeResult
let probe: ReturnType<typeof vi.fn<(endpoint: { host: string; port: number }) => Promise<ProbeResult>>>
let onRevoked: ReturnType<typeof vi.fn<() => void>>

const selfSigned = generateSelfSignedCertificate({ altNames: ['panel.example'] })
const replacement = generateSelfSignedCertificate({ altNames: ['panel.example'] })
const expired = generateSelfSignedCertificate({
  altNames: ['panel.example'],
  notBefore: new Date(Date.now() - 40 * DAY),
  notAfter: new Date(Date.now() - 10 * DAY)
})

function presented(certificate: GeneratedCertificate, authorized = false): ProbeResult {
  return { authorized, error: authorized ? null : 'DEPTH_ZERO_SELF_SIGNED_CERT', certificate: readCertificate(certificate.cert) }
}

function createPolicy(): TlsPolicy {
  return new TlsPolicy({
    store: new TrustStore({ filePath: join(dir, 'tls-trust.json') }),
    caFile: async (extra = []) => join(dir, `ca-${extra.length}.pem`),
    probe,
    notify: (notice) => notices.push(notice),
    onRevoked,
    now: () => clock
  })
}

function chromiumError(policy: TlsPolicy, certificate: GeneratedCertificate, url = `${SOURCE}/player_api.php?username=u&password=p`) {
  return policy.handleCertificateError({ url, error: 'net::ERR_CERT_AUTHORITY_INVALID', certificate: certificate.cert })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'abi-tls-policy-'))
  clock = Date.now()
  notices = []
  probeResult = presented(selfSigned)
  probe = vi.fn(async () => probeResult)
  onRevoked = vi.fn()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('Chromium certificate errors', () => {
  it('refuses an unknown certificate and reports what was presented', () => {
    const policy = createPolicy()
    expect(chromiumError(policy, selfSigned)).toBe(false)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      host: 'panel.example',
      port: 8443,
      fingerprint256: selfSigned.fingerprint256,
      problems: ['authority'],
      context: 'network',
      changed: false
    })
    expect(policy.listUntrusted()).toHaveLength(1)
  })

  it('accepts exactly the pinned certificate once the user trusted it', async () => {
    const policy = createPolicy()
    chromiumError(policy, selfSigned)
    await policy.trust({ host: 'panel.example', port: 8443, fingerprint256: selfSigned.fingerprint256, sourceId: 's1' })

    expect(chromiumError(policy, selfSigned)).toBe(true)
    expect(policy.listTrusted()).toMatchObject([{ host: 'panel.example', port: 8443, sourceIds: ['s1'] }])
    expect(policy.listUntrusted()).toEqual([])
  })

  it('refuses a changed certificate on a pinned host and says it changed', async () => {
    const policy = createPolicy()
    chromiumError(policy, selfSigned)
    await policy.trust({ host: 'panel.example', port: 8443, fingerprint256: selfSigned.fingerprint256 })
    notices = []

    expect(chromiumError(policy, replacement)).toBe(false)
    expect(notices).toMatchObject([{ fingerprint256: replacement.fingerprint256, changed: true }])
  })

  it('pins per port: the same host on another port is not trusted', async () => {
    const policy = createPolicy()
    chromiumError(policy, selfSigned)
    await policy.trust({ host: 'panel.example', port: 8443, fingerprint256: selfSigned.fingerprint256 })
    expect(chromiumError(policy, selfSigned, 'https://panel.example:9443/x')).toBe(false)
  })

  it('normalizes the host of the failure and of the trust request', async () => {
    const policy = createPolicy()
    const idn = generateSelfSignedCertificate({ altNames: ['xn--bcher-kva.example'] })
    chromiumError(policy, idn, 'https://BÜCHER.example/get.php')
    await policy.trust({ host: 'Bücher.Example.', port: 443, fingerprint256: idn.fingerprint256.toLowerCase() })
    expect(chromiumError(policy, idn, 'https://xn--bcher-kva.example/get.php')).toBe(true)
  })

  it('never relaxes GitHub or TMDB, reports nothing for them and refuses to trust them', async () => {
    const policy = createPolicy()
    for (const host of ['api.themoviedb.org', 'image.tmdb.org', 'github.com', 'objects.githubusercontent.com']) {
      expect(chromiumError(policy, selfSigned, `https://${host}/x`)).toBe(false)
      await expect(policy.trust({ host, port: 443, fingerprint256: selfSigned.fingerprint256 })).rejects.toBeInstanceOf(
        CertificateTrustError
      )
    }
    expect(notices).toEqual([])
    expect(policy.listTrusted()).toEqual([])
  })

  it('only trusts a certificate main itself saw for that host and port', async () => {
    const policy = createPolicy()
    await expect(
      policy.trust({ host: 'panel.example', port: 8443, fingerprint256: selfSigned.fingerprint256 })
    ).rejects.toBeInstanceOf(CertificateTrustError)
    chromiumError(policy, selfSigned)
    await expect(
      policy.trust({ host: 'panel.example', port: 8443, fingerprint256: replacement.fingerprint256 })
    ).rejects.toBeInstanceOf(CertificateTrustError)
    await expect(policy.trust({ host: 'panel.example', port: 0, fingerprint256: 'x' })).rejects.toThrow()
  })

  it('reports a burst of failures of one certificate once', () => {
    const policy = createPolicy()
    for (let i = 0; i < 20; i += 1) chromiumError(policy, selfSigned, `${SOURCE}/img/logo/${i}.png`)
    expect(notices).toHaveLength(1)
    clock += NOTICE_THROTTLE_MS + 1
    chromiumError(policy, selfSigned)
    expect(notices).toHaveLength(2)
  })

  it('revocation makes the host strict again and closes pooled connections', async () => {
    const policy = createPolicy()
    chromiumError(policy, selfSigned)
    await policy.trust({ host: 'panel.example', port: 8443, fingerprint256: selfSigned.fingerprint256 })

    expect(await policy.revoke('PANEL.example', '8443')).toBe(true)
    expect(onRevoked).toHaveBeenCalledTimes(1)
    expect(chromiumError(policy, selfSigned)).toBe(false)
    expect(await policy.revoke('panel.example', 8443)).toBe(false)
    expect(onRevoked).toHaveBeenCalledTimes(1)
  })

  it('keeps trust across restarts through the store file', async () => {
    const first = createPolicy()
    chromiumError(first, selfSigned)
    await first.trust({ host: 'panel.example', port: 8443, fingerprint256: selfSigned.fingerprint256 })
    expect(chromiumError(createPolicy(), selfSigned)).toBe(true)
  })
})

async function trusted(policy: TlsPolicy, certificate: GeneratedCertificate): Promise<void> {
  chromiumError(policy, certificate)
  await policy.trust({ ...ENDPOINT, fingerprint256: certificate.fingerprint256 })
  notices = []
}

describe('mpv load options', () => {
  it('passes nothing for plain HTTP', async () => {
    expect(await createPolicy().mpvLoadOptions('http://panel.example/live/u/p/1.ts')).toEqual({})
    expect(probe).not.toHaveBeenCalled()
  })

  it('verifies an unpinned HTTPS load and inspects its certificate in the background', async () => {
    const policy = createPolicy()
    expect(await policy.mpvLoadOptions(`${SOURCE}/live/u/p/1.ts`)).toEqual({ 'tls-verify': 'yes' })
    await vi.waitFor(() => expect(notices).toHaveLength(1))
    expect(notices[0]).toMatchObject({ host: 'panel.example', port: 8443, context: 'playback' })

    // One look per host for a while, not one per channel switch.
    await policy.mpvLoadOptions(`${SOURCE}/live/u/p/2.ts`)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('reports nothing when the background look finds a valid chain', async () => {
    probeResult = presented(selfSigned, true)
    const policy = createPolicy()
    await policy.mpvLoadOptions(`${SOURCE}/live/u/p/1.ts`)
    await vi.waitFor(() => expect(probe).toHaveBeenCalled())
    expect(notices).toEqual([])
  })

  it('verifies a pinned self-signed host against a CA file that holds its pin', async () => {
    const policy = createPolicy()
    await trusted(policy, selfSigned)
    expect(await policy.mpvLoadOptions(`${SOURCE}/movie/u/p/1.mp4`)).toEqual({
      'tls-verify': 'yes',
      'tls-ca-file': join(dir, 'ca-1.pem')
    })
  })

  it('relaxes an expired pinned host only after seeing the pinned certificate there', async () => {
    const policy = createPolicy()
    await trusted(policy, expired)
    probeResult = presented(expired)
    expect(await policy.mpvLoadOptions(`${SOURCE}/movie/u/p/1.mp4`)).toEqual({ 'tls-verify': 'no' })
    expect(probe).toHaveBeenCalledWith(ENDPOINT)
  })

  it('refuses the load when a pinned host presents another certificate', async () => {
    const policy = createPolicy()
    await trusted(policy, expired)
    probeResult = presented(replacement)
    await expect(policy.mpvLoadOptions(`${SOURCE}/movie/u/p/1.mp4`)).rejects.toBeInstanceOf(CertificateTrustError)
    expect(notices).toMatchObject([{ fingerprint256: replacement.fingerprint256, changed: true, context: 'playback' }])
  })

  it('does not relax when the pinned host cannot be reached for the check', async () => {
    const policy = createPolicy()
    await trusted(policy, expired)
    probeResult = { authorized: false, error: 'ECONNREFUSED', certificate: null }
    expect(await policy.mpvLoadOptions(`${SOURCE}/movie/u/p/1.mp4`)).toMatchObject({ 'tls-verify': 'yes' })
  })

  it('never relaxes TMDB or GitHub, even with a pin-shaped request', async () => {
    const policy = createPolicy()
    expect(await policy.mpvLoadOptions('https://image.tmdb.org/t/p/w500/x.jpg')).toEqual({ 'tls-verify': 'yes' })
  })
})

describe('ffmpeg arguments', () => {
  it('passes nothing for plain HTTP', async () => {
    expect(await createPolicy().ffmpegArgs('http://panel.example/movie/u/p/1.mkv')).toEqual([])
  })

  it('always gives GnuTLS a CA file when verifying', async () => {
    expect(await createPolicy().ffmpegArgs(`${SOURCE}/movie/u/p/1.mkv`)).toEqual([
      '-tls_verify',
      '1',
      '-ca_file',
      join(dir, 'ca-0.pem')
    ])
  })

  it('follows the same pin rules as mpv', async () => {
    const policy = createPolicy()
    await trusted(policy, selfSigned)
    expect(await policy.ffmpegArgs(`${SOURCE}/movie/u/p/1.mkv`)).toEqual(['-tls_verify', '1', '-ca_file', join(dir, 'ca-1.pem')])

    const relaxedPolicy = createPolicy()
    await relaxedPolicy.revoke(ENDPOINT.host, ENDPOINT.port)
    await trusted(relaxedPolicy, expired)
    probeResult = presented(expired)
    expect(await relaxedPolicy.ffmpegArgs(`${SOURCE}/movie/u/p/1.mkv`)).toEqual(['-tls_verify', '0'])
  })
})
