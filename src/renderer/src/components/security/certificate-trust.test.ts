import { describe, expect, it } from 'vitest'
import type { TrustedCertificateHost, UntrustedCertificateNotice } from '@/services/platform'
import type { PlaylistSource } from '@/types/playlist'
import {
  describeProblems,
  enqueuePrompt,
  hostOf,
  noticeOwner,
  pinsToRevoke,
  PENDING_SOURCE_TTL_MS,
  type OwnerContext,
  type PendingSource
} from './certificate-trust'

const NOW = 1_700_000_000_000

function notice(overrides: Partial<UntrustedCertificateNotice> = {}): UntrustedCertificateNotice {
  return {
    host: 'panel.example',
    port: 8443,
    fingerprint256: 'AA:'.repeat(31) + 'AA',
    subject: 'CN=panel.example',
    issuer: 'CN=panel.example',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2026-02-01T00:00:00.000Z',
    problems: ['authority'],
    error: 'net::ERR_CERT_AUTHORITY_INVALID',
    context: 'network',
    changed: false,
    seenAt: NOW,
    ...overrides
  }
}

function source(id: string, url: string, type: PlaylistSource['type'] = 'xtream'): PlaylistSource {
  return { id, name: `Kaynak ${id}`, type, url, addedAt: 0 }
}

function context(overrides: Partial<OwnerContext> = {}): OwnerContext {
  return { sources: [], pending: [], playbackStreamUrl: null, playbackSourceId: null, now: NOW, ...overrides }
}

const pending = (host: string, submittedAt = NOW): PendingSource => ({ host, submittedAt, resubmit: () => true })

describe('hostOf', () => {
  it('matches the host main reports: lower case, punycode, no brackets', () => {
    expect(hostOf('https://Panel.Example:8443/x')).toBe('panel.example')
    expect(hostOf('https://bücher.example/')).toBe('xn--bcher-kva.example')
    expect(hostOf('https://[::1]:9000/')).toBe('::1')
    expect(hostOf('panel.example:8080')).toBe('panel.example')
    expect(hostOf('')).toBeNull()
  })
})

describe('noticeOwner', () => {
  it('asks about a configured source host', () => {
    const owner = noticeOwner(notice(), context({ sources: [source('s1', 'https://PANEL.example:8443')] }))
    expect(owner).toMatchObject({ kind: 'source', source: { id: 's1' } })
  })

  it('asks about a source the user is adding, only while that submission is fresh', () => {
    expect(noticeOwner(notice(), context({ pending: [pending('panel.example')] }))?.kind).toBe('pending')
    expect(
      noticeOwner(notice(), context({ pending: [pending('panel.example', NOW - PENDING_SOURCE_TTL_MS - 1)] }))
    ).toBeNull()
  })

  it('asks about the host the current playback streams from', () => {
    const owner = noticeOwner(
      notice({ host: 'cdn.example', context: 'playback' }),
      context({
        sources: [source('s1', 'https://panel.example')],
        playbackStreamUrl: 'https://cdn.example/live/u/p/1.ts',
        playbackSourceId: 's1'
      })
    )
    expect(owner).toMatchObject({ kind: 'playback', source: { id: 's1' } })
  })

  it('never asks about a host that is not one of the user’s sources', () => {
    const owner = noticeOwner(
      notice({ host: 'logos.example' }),
      context({ sources: [source('s1', 'https://panel.example')], playbackStreamUrl: 'https://panel.example/1.ts' })
    )
    expect(owner).toBeNull()
  })

  it('ignores local-file sources', () => {
    expect(noticeOwner(notice(), context({ sources: [source('f', 'https://panel.example', 'm3u_file')] }))).toBeNull()
  })
})

describe('enqueuePrompt', () => {
  it('keeps one prompt per host and port, the newest in place', () => {
    const first = { notice: notice(), owner: { kind: 'pending' as const, pending: pending('panel.example') } }
    const other = { notice: notice({ host: 'b.example' }), owner: first.owner }
    const changed = { notice: notice({ changed: true }), owner: first.owner }
    const queue = enqueuePrompt(enqueuePrompt([first], other), changed)
    expect(queue.map((prompt) => [prompt.notice.host, prompt.notice.changed])).toEqual([
      ['panel.example', true],
      ['b.example', false]
    ])
  })
})

describe('describeProblems', () => {
  it('explains each problem in Turkish', () => {
    const lines = describeProblems(notice({ problems: ['authority', 'expired', 'name-mismatch'] }))
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/sertifika yetkilisi/)
    expect(lines[1]).toMatch(/süresi .* tarihinde dolmuş/)
    expect(lines[2]).toMatch(/başka bir sunucu adı/)
    expect(describeProblems(notice({ problems: [] }))).toEqual(['Sertifika doğrulanamadı.'])
  })
})

describe('pinsToRevoke', () => {
  const pin = (host: string, sourceIds: string[] = []): TrustedCertificateHost => ({
    host,
    port: 443,
    sourceIds,
    fingerprint256: 'AA',
    subject: '',
    issuer: '',
    validFrom: '',
    validTo: '',
    problems: ['authority'],
    trustedAt: 0
  })

  it('drops the pins of a removed source: by its host and by its id', () => {
    const removed = [source('s1', 'https://panel.example')]
    const pins = [pin('panel.example'), pin('cdn.example', ['s1']), pin('other.example', ['s2'])]
    expect(pinsToRevoke(removed, [source('s2', 'https://other.example')], pins).map((p) => p.host)).toEqual([
      'panel.example',
      'cdn.example'
    ])
  })

  it('keeps a pin another remaining source still uses', () => {
    const removed = [source('s1', 'https://panel.example')]
    const remaining = [source('s2', 'https://panel.example:8443')]
    const pins = [pin('panel.example', ['s1']), pin('cdn.example', ['s1', 's2'])]
    expect(pinsToRevoke(removed, remaining, pins)).toEqual([])
  })
})
