import { existsSync, readFileSync, renameSync } from 'fs'
import type { CertificateProblem, TrustedCertificateHost } from '../../shared/ipc/contract'
import { writeFileAtomic } from '../ipc/atomic-file'
import { normalizeFingerprint, readCertificate } from './certificate'
import { endpointKey, isNeverRelaxableHost, normalizeHost, normalizePort, type TlsEndpoint } from './hosts'

/** A trusted host as stored: the public summary plus the pinned certificate. */
export interface StoredPin extends TrustedCertificateHost {
  pem: string
}

interface StoreFile {
  version: 1
  pins: StoredPin[]
}

const PROBLEMS: ReadonlySet<CertificateProblem> = new Set([
  'authority',
  'expired',
  'not-yet-valid',
  'name-mismatch',
  'other'
])

export interface TrustStoreOptions {
  filePath: string
  log?: (message: string, error?: unknown) => void
  now?: () => number
}

/** Rebuilds an entry from untrusted JSON; null drops it. */
export function sanitizePin(value: unknown): StoredPin | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const host = normalizeHost(raw.host)
  const port = normalizePort(raw.port)
  const fingerprint = normalizeFingerprint(raw.fingerprint256)
  if (!host || !port || !fingerprint || isNeverRelaxableHost(host)) return null
  if (typeof raw.pem !== 'string') return null
  const certificate = readCertificate(raw.pem)
  // The fingerprint is what is enforced; it must be the stored certificate's.
  if (!certificate || certificate.fingerprint256 !== fingerprint) return null
  const problems = Array.isArray(raw.problems)
    ? raw.problems.filter((problem): problem is CertificateProblem => PROBLEMS.has(problem as CertificateProblem))
    : []
  const sourceIds = Array.isArray(raw.sourceIds)
    ? [...new Set(raw.sourceIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))]
    : []
  return {
    host,
    port,
    fingerprint256: fingerprint,
    subject: certificate.subject,
    issuer: certificate.issuer,
    validFrom: certificate.validFrom,
    validTo: certificate.validTo,
    problems,
    sourceIds,
    trustedAt: typeof raw.trustedAt === 'number' && Number.isFinite(raw.trustedAt) ? raw.trustedAt : 0,
    pem: certificate.pem
  }
}

/**
 * Pins the user agreed to, one per host and port, in a small JSON file under
 * userData. Read once, synchronously, at start: Chromium may ask about a
 * certificate before anything async has run. Every change is written
 * atomically; writes are serialized.
 */
export class TrustStore {
  private readonly pins = new Map<string, StoredPin>()
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly options: TrustStoreOptions) {
    this.load()
  }

  private log(message: string, error?: unknown): void {
    this.options.log?.(message, error)
  }

  private load(): void {
    const { filePath } = this.options
    if (!existsSync(filePath)) return
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch (error) {
      this.quarantine(error)
      return
    }
    const pins = (parsed as Partial<StoreFile> | null)?.pins
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(pins)) {
      this.quarantine(new Error('unexpected shape'))
      return
    }
    for (const entry of pins) {
      const pin = sanitizePin(entry)
      if (pin) this.pins.set(endpointKey(pin), pin)
    }
  }

  /**
   * An unreadable file is kept aside for diagnosis and the store starts empty:
   * every host is then strict again, which is the safe direction to fail.
   */
  private quarantine(error: unknown): void {
    const aside = `${this.options.filePath}.corrupt-${(this.options.now ?? Date.now)()}`
    try {
      renameSync(this.options.filePath, aside)
    } catch (renameError) {
      this.log('tls trust store: could not move the unreadable file aside', renameError)
    }
    this.log('tls trust store: unreadable, starting empty', error)
  }

  get(endpoint: TlsEndpoint): StoredPin | null {
    return this.pins.get(endpointKey(endpoint)) ?? null
  }

  list(): StoredPin[] {
    return [...this.pins.values()].sort((a, b) => endpointKey(a).localeCompare(endpointKey(b)))
  }

  /** Adds or replaces the pin for the pin's host and port. */
  async put(pin: StoredPin): Promise<void> {
    const clean = sanitizePin(pin)
    if (!clean) throw new Error('Geçersiz sertifika kaydı')
    this.pins.set(endpointKey(clean), clean)
    await this.persist()
  }

  async remove(endpoint: TlsEndpoint): Promise<boolean> {
    const removed = this.pins.delete(endpointKey(endpoint))
    if (removed) await this.persist()
    return removed
  }

  private persist(): Promise<void> {
    const body: StoreFile = { version: 1, pins: this.list() }
    const data = JSON.stringify(body, null, 2)
    const run = this.writing.then(() => writeFileAtomic(this.options.filePath, data))
    this.writing = run.catch((error: unknown) => this.log('tls trust store: write failed', error))
    return run
  }
}
