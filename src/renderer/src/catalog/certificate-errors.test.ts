import { describe, expect, it } from 'vitest'
import { PlaylistRequestError } from '@/services/m3u-parser'
import { classifyError, toUserMessage, USER_ERROR_MESSAGES } from '@/services/user-error'
import { XtreamRequestError } from '@/services/xtream-errors'
import type { UntrustedCertificateNotice } from '@/services/platform'
import { certificateAwareError } from './certificate-errors'

const notice = (host: string) => ({ host, port: 443 }) as UntrustedCertificateNotice

describe('certificate-aware request errors', () => {
  it('turns a network failure on a host main refused a certificate for into the certificate message', async () => {
    const failed = new XtreamRequestError('network', 'Sunucuya bağlanılamadı.', { host: 'panel.example' })
    const mapped = await certificateAwareError(failed, async () => [notice('panel.example')])
    expect(mapped).toBeInstanceOf(XtreamRequestError)
    expect(classifyError(mapped)).toBe('certificate')
    expect(toUserMessage(mapped)).toBe(USER_ERROR_MESSAGES.certificate)
    expect((mapped as XtreamRequestError).retryable).toBe(false)

    const playlist = await certificateAwareError(new PlaylistRequestError('network', 'x', { host: 'cdn.example' }), async () => [notice('cdn.example')])
    expect(playlist).toBeInstanceOf(PlaylistRequestError)
    expect(classifyError(playlist)).toBe('certificate')
  })

  it('leaves other failures and other hosts alone', async () => {
    const other = new XtreamRequestError('network', 'x', { host: 'panel.example' })
    expect(await certificateAwareError(other, async () => [notice('logos.example')])).toBe(other)
    const auth = new XtreamRequestError('auth', 'x', { host: 'panel.example' })
    expect(await certificateAwareError(auth, async () => [notice('panel.example')])).toBe(auth)
    const plain = new Error('x')
    expect(await certificateAwareError(plain, async () => [notice('panel.example')])).toBe(plain)
    expect(await certificateAwareError(other, async () => Promise.reject(new Error('ipc')))).toBe(other)
  })
})
