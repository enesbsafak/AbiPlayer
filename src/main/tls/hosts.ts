import { isIP } from 'net'
import { domainToASCII } from 'url'

/**
 * Update traffic. electron-updater downloads through Chromium's network stack
 * and the Windows build is unsigned (`forceCodeSigning: false`), so trusting a
 * bad certificate here would let a network attacker hand us an installer.
 */
export const GITHUB_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

/** TMDB calls carry the user's API key. */
export const TMDB_HOSTS: ReadonlySet<string> = new Set(['api.themoviedb.org', 'image.tmdb.org'])

export interface TlsEndpoint {
  /** Lower-case ASCII; IDN in punycode; IPv6 without brackets. */
  host: string
  port: number
}

/**
 * Canonical form of a host name as Chromium, Node and mpv see it, or null
 * when it is not a usable host. `Bücher.example.` and `xn--bcher-kva.example`
 * are the same host.
 */
export function normalizeHost(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let host = value.trim()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (!host) return null
  if (isIP(host) === 6) return host.toLowerCase()
  if (isIP(host) === 4) return host
  host = host.replace(/\.+$/, '')
  const ascii = domainToASCII(host)
  if (!ascii || ascii.length > 253) return null
  return ascii.toLowerCase()
}

export function normalizePort(value: unknown): number | null {
  const port = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

/** The TLS endpoint of an https:// (or wss://) URL; null for anything else. */
export function tlsEndpointOf(url: string): TlsEndpoint | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') return null
  const host = normalizeHost(parsed.hostname)
  const port = parsed.port ? normalizePort(parsed.port) : 443
  return host && port ? { host, port } : null
}

export function endpointKey(endpoint: TlsEndpoint): string {
  return isIP(endpoint.host) === 6 ? `[${endpoint.host}]:${endpoint.port}` : `${endpoint.host}:${endpoint.port}`
}

export function isGithubHost(host: string): boolean {
  const normalized = normalizeHost(host)
  if (!normalized) return false
  return GITHUB_HOSTS.has(normalized) || normalized.endsWith('.githubusercontent.com')
}

/** Hosts whose certificate errors are never relaxed, whatever asks. */
export function isNeverRelaxableHost(host: string): boolean {
  const normalized = normalizeHost(host)
  if (!normalized) return true
  return isGithubHost(normalized) || TMDB_HOSTS.has(normalized)
}
