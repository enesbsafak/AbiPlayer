import type { CertificateProblem, TrustedCertificateHost, UntrustedCertificateNotice } from '@/services/platform'
import type { PlaylistSource } from '@/types/playlist'

/** How long a submitted add-source form counts as "being added". */
export const PENDING_SOURCE_TTL_MS = 2 * 60_000
/** After "Vazgeç", the same certificate does not prompt again for this long. */
export const DISMISS_QUIET_MS = 60_000

/** Lower-case ASCII host of a URL as main reports it (punycode, IPv6 without brackets). */
export function hostOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim()) ? url.trim() : `http://${url.trim()}`)
    const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
    return host || null
  } catch {
    return null
  }
}

export function endpointLabel(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

export function noticeKey(notice: Pick<UntrustedCertificateNotice, 'host' | 'port' | 'fingerprint256'>): string {
  return `${endpointLabel(notice.host, notice.port)}|${notice.fingerprint256}`
}

/** A form the user submitted to add a source, still waiting for its answer. */
export interface PendingSource {
  host: string
  submittedAt: number
  /** Submits the same form again; false when it is gone or was edited since. */
  resubmit: () => boolean
}

export type NoticeOwner =
  | { kind: 'pending'; pending: PendingSource }
  | { kind: 'source'; source: PlaylistSource }
  | { kind: 'playback'; source: PlaylistSource | null }

export interface OwnerContext {
  sources: PlaylistSource[]
  pending: PendingSource[]
  /** Stream URL of the current playback, if any. */
  playbackStreamUrl: string | null
  playbackSourceId: string | null
  now: number
}

/**
 * Whose certificate this is. Only a host the user configured, is adding, or
 * is playing from gets a prompt; a logo or EPG host with a bad certificate
 * never does.
 */
export function noticeOwner(notice: UntrustedCertificateNotice, context: OwnerContext): NoticeOwner | null {
  const pending = context.pending.find(
    (entry) => entry.host === notice.host && context.now - entry.submittedAt <= PENDING_SOURCE_TTL_MS
  )
  if (pending) return { kind: 'pending', pending }

  const playbackSource = context.sources.find((source) => source.id === context.playbackSourceId) ?? null
  if (hostOf(context.playbackStreamUrl) === notice.host && notice.context !== 'network') {
    return { kind: 'playback', source: playbackSource }
  }

  const source = context.sources.find((entry) => entry.type !== 'm3u_file' && hostOf(entry.url) === notice.host)
  if (source) return { kind: 'source', source }

  if (hostOf(context.playbackStreamUrl) === notice.host) return { kind: 'playback', source: playbackSource }
  return null
}

export interface TrustPrompt {
  notice: UntrustedCertificateNotice
  owner: NoticeOwner
}

/**
 * One prompt per host and port: a newer notice for an endpoint already queued
 * (a changed certificate, say) takes that entry's place; others wait in line.
 */
export function enqueuePrompt(queue: TrustPrompt[], prompt: TrustPrompt): TrustPrompt[] {
  const endpoint = endpointLabel(prompt.notice.host, prompt.notice.port)
  const index = queue.findIndex((entry) => endpointLabel(entry.notice.host, entry.notice.port) === endpoint)
  if (index < 0) return [...queue, prompt]
  return queue.map((entry, position) => (position === index ? prompt : entry))
}

function formatDate(iso: string): string {
  const time = Date.parse(iso)
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('tr-TR') : iso
}

/** One plain Turkish sentence per problem. */
export function describeProblems(notice: Pick<UntrustedCertificateNotice, 'problems' | 'validFrom' | 'validTo'>): string[] {
  const text: Record<CertificateProblem, string> = {
    authority:
      'Sertifikayı tanınmış bir sertifika yetkilisi imzalamamış; büyük olasılıkla sunucu kendi sertifikasını kendisi imzalamış.',
    expired: `Sertifikanın süresi ${formatDate(notice.validTo)} tarihinde dolmuş.`,
    'not-yet-valid': `Sertifika ${formatDate(notice.validFrom)} tarihinden önce geçerli değil.`,
    'name-mismatch': 'Sertifika bu adres için değil, başka bir sunucu adı için düzenlenmiş.',
    other: 'Sertifika doğrulanamadı.'
  }
  const problems = notice.problems.length > 0 ? notice.problems : (['other'] as CertificateProblem[])
  return problems.map((problem) => text[problem])
}

export function shortFingerprint(fingerprint: string): string {
  return fingerprint.split(':').slice(0, 8).join(':')
}

/**
 * Pins to drop when sources are removed: those given for a removed source or
 * for its host, unless a remaining source still needs them.
 */
export function pinsToRevoke(
  removed: PlaylistSource[],
  remaining: PlaylistSource[],
  pins: TrustedCertificateHost[]
): TrustedCertificateHost[] {
  const removedIds = new Set(removed.map((source) => source.id))
  const removedHosts = new Set(removed.map((source) => hostOf(source.url)).filter((host): host is string => !!host))
  const remainingIds = new Set(remaining.map((source) => source.id))
  const remainingHosts = new Set(remaining.map((source) => hostOf(source.url)).filter((host): host is string => !!host))

  return pins.filter((pin) => {
    const belongedToRemoved = removedHosts.has(pin.host) || pin.sourceIds.some((id) => removedIds.has(id))
    if (!belongedToRemoved) return false
    const stillNeeded = remainingHosts.has(pin.host) || pin.sourceIds.some((id) => remainingIds.has(id))
    return !stillNeeded
  })
}
