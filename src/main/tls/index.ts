import { app, BrowserWindow, session } from 'electron'
import { getCACertificates } from 'tls'
import { join } from 'path'
import { broadcastEvent } from '../ipc/events'
import { CaBundles } from './ca-bundle'
import { TlsPolicy } from './policy'
import { createCertificateProbe } from './probe'
import { TrustStore } from './trust-store'

export { CertificateTrustError, TlsPolicy } from './policy'

let systemRoots: readonly string[] | null = null

/** The operating system's trusted roots (the Windows store on Windows), read once. */
function readSystemRoots(): readonly string[] {
  if (!systemRoots) {
    try {
      systemRoots = getCACertificates('system')
    } catch {
      systemRoots = []
    }
  }
  return systemRoots
}

let policy: TlsPolicy | null = null

/** The process-wide policy; created on first use, after `app` is ready. */
export function getTlsPolicy(): TlsPolicy {
  if (policy) return policy
  const dir = join(app.getPath('userData'), 'tls')
  const bundles = new CaBundles(dir, readSystemRoots)
  void bundles.removeStale()
  policy = new TlsPolicy({
    store: new TrustStore({
      filePath: join(app.getPath('userData'), 'tls-trust.json'),
      log: (message, error) => console.warn(`[tls] ${message}`, error ?? '')
    }),
    caFile: (extra) => bundles.fileFor(extra),
    probe: createCertificateProbe(readSystemRoots),
    notify: (notice) =>
      broadcastEvent(
        BrowserWindow.getAllWindows()
          .filter((window) => !window.isDestroyed())
          .map((window) => window.webContents),
        'tls-untrusted-certificate',
        notice
      ),
    onRevoked: () => {
      void session.defaultSession.closeAllConnections().catch(() => undefined)
    }
  })
  return policy
}
