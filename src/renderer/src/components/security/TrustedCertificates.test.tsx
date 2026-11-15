import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({
  onUntrustedCertificate: vi.fn(() => () => {}),
  tlsListTrusted: vi.fn(),
  tlsListUntrusted: vi.fn(),
  tlsRevoke: vi.fn(async () => true)
}))

vi.mock('@/services/platform', () => platform)

import { useStore } from '@/store'
import { TrustedCertificates } from './TrustedCertificates'

const pin = {
  host: 'panel.example',
  port: 8443,
  sourceIds: ['s1'],
  fingerprint256: 'AB:'.repeat(31) + 'AB',
  subject: 'CN=panel.example',
  issuer: 'CN=panel.example',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
  problems: ['authority'],
  trustedAt: 0
}

beforeEach(() => {
  useStore.setState({
    sources: [{ id: 's1', name: 'Sağlayıcım', type: 'xtream', url: 'https://panel.example:8443', addedAt: 0 }]
  })
  platform.tlsListTrusted.mockResolvedValue([pin])
  platform.tlsListUntrusted.mockResolvedValue([])
})

afterEach(() => cleanup())

describe('TrustedCertificates', () => {
  it('lists trusted servers and revokes one', async () => {
    render(<TrustedCertificates />)
    const list = await screen.findByRole('list', { name: 'Güvenilen sunucular' })
    expect(list.textContent).toContain('panel.example:8443')

    platform.tlsListTrusted.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'panel.example:8443 için güveni kaldır' }))
    await waitFor(() => expect(platform.tlsRevoke).toHaveBeenCalledWith('panel.example', 8443))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Güvenilen sunucular' })).toBeNull())
  })

  it('offers refused certificates of the user’s sources, not of other hosts', async () => {
    platform.tlsListTrusted.mockResolvedValue([])
    platform.tlsListUntrusted.mockResolvedValue([
      { ...pin, error: 'net::ERR_CERT_AUTHORITY_INVALID', context: 'network', changed: false, seenAt: 1 },
      { ...pin, host: 'logos.example', error: 'x', context: 'network', changed: false, seenAt: 1 }
    ])
    render(<TrustedCertificates />)
    const waiting = await screen.findByRole('list', { name: 'Onay bekleyen sertifikalar' })
    expect(waiting.textContent).toContain('panel.example:8443')
    expect(waiting.textContent).not.toContain('logos.example')
    expect(screen.getByRole('button', { name: 'İncele' })).toBeTruthy()
  })
})
