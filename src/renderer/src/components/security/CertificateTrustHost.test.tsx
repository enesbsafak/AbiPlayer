import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UntrustedCertificateNotice } from '@/services/platform'

const platform = vi.hoisted(() => {
  const listeners = new Set<(notice: unknown) => void>()
  return {
    listeners,
    onUntrustedCertificate: vi.fn((listener: (notice: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    tlsListUntrusted: vi.fn(async () => []),
    tlsListTrusted: vi.fn(async () => []),
    tlsTrust: vi.fn(async () => ({})),
    tlsRevoke: vi.fn(async () => true)
  }
})

vi.mock('@/services/platform', () => platform)

import { useStore } from '@/store'
import { CertificateTrustHost } from './CertificateTrustHost'
import { clearPendingSources, notePendingSource, useTrustPrompts } from './trust-prompts'

function notice(overrides: Partial<UntrustedCertificateNotice> = {}): UntrustedCertificateNotice {
  return {
    host: 'panel.example',
    port: 8443,
    fingerprint256: 'AB:'.repeat(31) + 'AB',
    subject: 'CN=panel.example',
    issuer: 'CN=panel.example',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2027-01-01T00:00:00.000Z',
    problems: ['authority'],
    error: 'net::ERR_CERT_AUTHORITY_INVALID',
    context: 'network',
    changed: false,
    seenAt: Date.now(),
    ...overrides
  }
}

function emit(value: UntrustedCertificateNotice): void {
  act(() => {
    for (const listener of platform.listeners) listener(value)
  })
}

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

beforeEach(() => {
  platform.listeners.clear()
  clearPendingSources()
  useTrustPrompts.setState({ queue: [], dismissedAt: {} })
  useStore.setState({
    sources: [{ id: 's1', name: 'Sağlayıcım', type: 'xtream', url: 'https://panel.example:8443', addedAt: 0 }],
    currentPlayback: null
  })
})

afterEach(() => {
  cleanup()
})

describe('CertificateTrustHost', () => {
  it('asks about a source host and, on consent, pins it and retries the connection', async () => {
    const tokenBefore = useStore.getState().connectRetryToken
    render(<CertificateTrustHost />)
    emit(notice())

    expect(await screen.findByText('Sunucunun sertifikası doğrulanamadı')).toBeTruthy()
    expect(screen.getByText(/Sağlayıcım/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Bu sunucuya güven' }))

    await waitFor(() => expect(platform.tlsTrust).toHaveBeenCalled())
    expect(platform.tlsTrust).toHaveBeenCalledWith({
      host: 'panel.example',
      port: 8443,
      fingerprint256: notice().fingerprint256,
      sourceId: 's1'
    })
    await waitFor(() => expect(screen.queryByText('Sunucunun sertifikası doğrulanamadı')).toBeNull())
    expect(useStore.getState().connectRetryToken).toBe(tokenBefore + 1)
  })

  it('reloads the current playback when its host is the one trusted', async () => {
    useStore.setState({
      currentChannel: { id: 'c1', name: 'TRT 1', streamUrl: '', sourceId: 's1', type: 'live' },
      currentPlayback: {
        playbackId: 'p1',
        target: { kind: 'live', sourceId: 's1', streamId: 1 },
        mediaKey: 'live:s1:1',
        streamUrl: 'https://panel.example:8443/live/u/p/1.m3u8'
      }
    } as never)
    const reloadsBefore = useStore.getState().playbackReloadToken
    render(<CertificateTrustHost />)
    emit(notice({ context: 'playback' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Bu sunucuya güven' }))
    await waitFor(() => expect(useStore.getState().playbackReloadToken).toBe(reloadsBefore + 1))
  })

  it('stays silent for a host that is not one of the sources', () => {
    render(<CertificateTrustHost />)
    emit(notice({ host: 'logos.example' }))
    expect(screen.queryByRole('button', { name: 'Bu sunucuya güven' })).toBeNull()
  })

  it('says so when the certificate changed', async () => {
    render(<CertificateTrustHost />)
    emit(notice({ changed: true }))
    expect(await screen.findByText('Sunucunun sertifikası değişti')).toBeTruthy()
  })

  it('resubmits the add-source form after consent instead of reconnecting', async () => {
    useStore.setState({ sources: [] })
    const resubmit = vi.fn(() => true)
    notePendingSource('https://new.example:9443', resubmit)
    const tokenBefore = useStore.getState().connectRetryToken
    render(<CertificateTrustHost />)
    emit(notice({ host: 'new.example', port: 9443 }))

    fireEvent.click(await screen.findByRole('button', { name: 'Bu sunucuya güven' }))
    await waitFor(() => expect(resubmit).toHaveBeenCalledTimes(1))
    expect(useStore.getState().connectRetryToken).toBe(tokenBefore)
  })

  it('after "Vazgeç" does not ask again for the same submission', async () => {
    useStore.setState({ sources: [] })
    notePendingSource('https://new.example', () => true)
    render(<CertificateTrustHost />)
    emit(notice({ host: 'new.example', port: 443 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Vazgeç' }))
    emit(notice({ host: 'new.example', port: 443 }))
    expect(screen.queryByRole('button', { name: 'Bu sunucuya güven' })).toBeNull()
  })

  it('shows why trust was refused', async () => {
    platform.tlsTrust.mockRejectedValueOnce(
      new Error("Error invoking remote method 'tls-trust': Error: Bu sunucunun sertifikası güvenlik gereği hiçbir koşulda gevşetilemez.")
    )
    render(<CertificateTrustHost />)
    emit(notice())
    fireEvent.click(await screen.findByRole('button', { name: 'Bu sunucuya güven' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/sertifika/)
  })

  it('removes the pins of a removed source', async () => {
    platform.tlsListTrusted.mockResolvedValueOnce([
      {
        host: 'panel.example',
        port: 8443,
        sourceIds: ['s1'],
        fingerprint256: 'AB',
        subject: '',
        issuer: '',
        validFrom: '',
        validTo: '',
        problems: [],
        trustedAt: 0
      }
    ] as never)
    render(<CertificateTrustHost />)
    act(() => useStore.getState().removeSource('s1'))
    await waitFor(() => expect(platform.tlsRevoke).toHaveBeenCalledWith('panel.example', 8443))
  })
})
