import { describe, expect, it } from 'vitest'
import { classifyError, stripErrorPrefixes, toUserMessage, USER_ERROR_MESSAGES } from './user-error'

describe('toUserMessage', () => {
  it('maps the browser network failure to Turkish', () => {
    expect(toUserMessage(new TypeError('Failed to fetch'))).toBe(USER_ERROR_MESSAGES.network)
  })

  it('maps an abort without reason to the cancelled message', () => {
    const error = new DOMException('signal is aborted without reason', 'AbortError')
    expect(toUserMessage(error)).toBe(USER_ERROR_MESSAGES.cancelled)
    expect(toUserMessage(new Error('signal is aborted without reason'))).toBe(
      USER_ERROR_MESSAGES.cancelled
    )
  })

  it('maps timeouts, including the old unaccented service text', () => {
    expect(toUserMessage(new DOMException('timed out', 'TimeoutError'))).toBe(
      USER_ERROR_MESSAGES.timeout
    )
    expect(toUserMessage(new Error('Istek zaman asimina ugradi (20s)'))).toBe(
      USER_ERROR_MESSAGES.timeout
    )
  })

  it('removes the Electron IPC prefix and keeps the Turkish reason', () => {
    const error = new Error(
      "Error invoking remote method 'pick-file-content': Error: Seçilen dosya çok büyük (en fazla 25MB)"
    )
    expect(toUserMessage(error)).toBe('Liste veya dosya çok büyük (en fazla 25MB).')
  })

  it('passes through the app’s own Turkish wording after stripping the prefix', () => {
    const error = new Error("Error invoking remote method 'secure-set': Error: Anahtar zinciri kilitli, açılamadı")
    expect(toUserMessage(error)).toBe('Anahtar zinciri kilitli, açılamadı')
    expect(toUserMessage(new Error('Bu URL zaten "Liste" olarak ekli: ğ'))).toContain('zaten')
  })

  it('uses the caller fallback for unknown English text', () => {
    expect(toUserMessage(new Error('Something odd happened'), 'İçe aktarma başarısız oldu')).toBe(
      'İçe aktarma başarısız oldu'
    )
    expect(toUserMessage(new Error('Something odd happened'))).toBe(USER_ERROR_MESSAGES.generic)
    expect(toUserMessage(undefined)).toBe(USER_ERROR_MESSAGES.generic)
  })

  it('maps authentication failures', () => {
    expect(toUserMessage(new Error('Kimlik doğrulama başarısız oldu'))).toBe(USER_ERROR_MESSAGES.auth)
    expect(toUserMessage(new Error('HTTP 401: Unauthorized'))).toBe(USER_ERROR_MESSAGES.auth)
  })

  it('reports other HTTP statuses with the code', () => {
    expect(toUserMessage(new Error('HTTP 502: Bad Gateway'))).toBe('Sunucu isteği reddetti (HTTP 502).')
    expect(toUserMessage(new Error('M3U indirilemedi: 404'))).toBe('Sunucu isteği reddetti (HTTP 404).')
  })

  it('accepts a plain string', () => {
    expect(toUserMessage('Failed to fetch')).toBe(USER_ERROR_MESSAGES.network)
  })
})

describe('typed errors with a kind', () => {
  function typed(kind: string, message = 'whatever', extra: Record<string, unknown> = {}) {
    return Object.assign(new Error(message), { kind }, extra)
  }

  it('honours the kind before the message', () => {
    expect(classifyError(typed('network', 'HTTP 500'))).toBe('network')
    expect(classifyError(typed('timeout'))).toBe('timeout')
    expect(classifyError(typed('aborted'))).toBe('cancelled')
    expect(classifyError(typed('auth'))).toBe('auth')
    expect(classifyError(typed('bad-response'))).toBe('bad-response')
  })

  it('uses the status of an http kind', () => {
    expect(toUserMessage(typed('http', 'x', { status: 503 }))).toBe('Sunucu isteği reddetti (HTTP 503).')
    expect(classifyError(typed('http', 'x', { status: 401 }))).toBe('auth')
  })

  it('falls back to message inspection for an unknown kind', () => {
    expect(classifyError(typed('mystery', 'Failed to fetch'))).toBe('network')
  })
})

describe('stripErrorPrefixes', () => {
  it('leaves an ordinary message alone', () => {
    expect(stripErrorPrefixes('  Hata: bir şey  ')).toBe('Hata: bir şey')
  })
})
