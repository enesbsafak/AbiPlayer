import { connect, rootCertificates, type PeerCertificate } from 'tls'
import { isIP } from 'net'
import { readCertificate, type CertificateDetails } from './certificate'
import type { TlsEndpoint } from './hosts'

export interface ProbeResult {
  /** The chain verified against the trusted roots and the name matched. */
  authorized: boolean
  /** OpenSSL / Node code when not authorized (e.g. DEPTH_ZERO_SELF_SIGNED_CERT). */
  error: string | null
  /** The leaf the server presented; null when no handshake happened. */
  certificate: CertificateDetails | null
}

export type CertificateProbe = (endpoint: TlsEndpoint) => Promise<ProbeResult>

export const PROBE_TIMEOUT_MS = 8000

function leafPem(certificate: PeerCertificate): CertificateDetails | null {
  if (!certificate || !certificate.raw) return null
  return readCertificate(certificate.raw)
}

/**
 * Opens a TLS connection, reads what the server presents and closes it
 * without sending a request. `roots` are the trusted authorities: Node's
 * bundled list plus the operating system's, which is what Chromium and mpv
 * trust on Windows.
 */
export function createCertificateProbe(roots: () => readonly string[], timeoutMs = PROBE_TIMEOUT_MS): CertificateProbe {
  return (endpoint) =>
    new Promise<ProbeResult>((resolve) => {
      let settled = false
      const finish = (result: ProbeResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        resolve(result)
      }
      const socket = connect({
        host: endpoint.host,
        port: endpoint.port,
        // SNI must not carry an IP literal.
        ...(isIP(endpoint.host) ? {} : { servername: endpoint.host }),
        ca: [...rootCertificates, ...roots()],
        rejectUnauthorized: false,
        ALPNProtocols: ['http/1.1']
      })
      const timer = setTimeout(
        () => finish({ authorized: false, error: 'ETIMEDOUT', certificate: null }),
        timeoutMs
      )
      socket.once('secureConnect', () => {
        const error = socket.authorizationError
        finish({
          authorized: socket.authorized,
          error: socket.authorized ? null : String(error instanceof Error ? error.message : (error ?? 'UNKNOWN')),
          certificate: leafPem(socket.getPeerCertificate(false))
        })
      })
      socket.once('error', (error: NodeJS.ErrnoException) =>
        finish({ authorized: false, error: error.code ?? error.message, certificate: null })
      )
    })
}
