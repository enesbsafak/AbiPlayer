// @vitest-environment node
import { createServer, type Server } from 'https'
import type { AddressInfo } from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { createCertificateProbe } from './probe'
import { generateSelfSignedCertificate } from './testing/self-signed'

const servers: Server[] = []

async function serve(cert: { cert: string; key: string }): Promise<number> {
  const server = createServer({ cert: cert.cert, key: cert.key }, (_req, res) => res.end('ok'))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

describe('createCertificateProbe (real TLS server)', () => {
  it('reports a self-signed certificate as unauthorized, with its fingerprint', async () => {
    const generated = generateSelfSignedCertificate({ altNames: ['127.0.0.1'] })
    const port = await serve(generated)
    const result = await createCertificateProbe(() => [])({ host: '127.0.0.1', port })
    expect(result.authorized).toBe(false)
    expect(result.error).toMatch(/SELF_SIGNED/)
    expect(result.certificate?.fingerprint256).toBe(generated.fingerprint256)
  })

  it('authorizes a certificate whose issuer is among the given roots', async () => {
    const generated = generateSelfSignedCertificate({ altNames: ['127.0.0.1'] })
    const port = await serve(generated)
    const result = await createCertificateProbe(() => [generated.cert])({ host: '127.0.0.1', port })
    expect(result).toMatchObject({ authorized: true, error: null })
  })

  it('reports a trusted certificate issued for another name as unauthorized', async () => {
    const generated = generateSelfSignedCertificate({ altNames: ['other.example'] })
    const port = await serve(generated)
    const result = await createCertificateProbe(() => [generated.cert])({ host: '127.0.0.1', port })
    expect(result.authorized).toBe(false)
    expect(result.certificate).not.toBeNull()
  })

  it('reports an unreachable host without a certificate', async () => {
    const generated = generateSelfSignedCertificate()
    const port = await serve(generated)
    await new Promise((resolve) => servers.pop()!.close(resolve))
    const result = await createCertificateProbe(() => [])({ host: '127.0.0.1', port })
    expect(result).toMatchObject({ authorized: false, certificate: null })
  })
})
