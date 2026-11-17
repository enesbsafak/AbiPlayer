import { describe, expect, it } from 'vitest'
import { XtreamRequestError } from '@/services/xtream-errors'
import { errors } from '@/strings/errors'
import { addonErrorMessage, isAddonRefusal } from './messages'

describe('add-on failures on screen', () => {
  it('words a refusal for an add-on, which has no user name or password', () => {
    const refused = new XtreamRequestError('http', errors.kinds.httpRefused(401), { status: 401, host: 'addon.example' })
    expect(isAddonRefusal(refused)).toBe(true)
    expect(addonErrorMessage(refused)).toBe(errors.addonRefused)
    expect(addonErrorMessage({ kind: 'http', status: 403, message: errors.kinds.httpRefused(403), retryable: false })).toBe(
      errors.addonRefused
    )
    expect(addonErrorMessage(refused)).not.toContain(errors.kinds.auth)
  })

  it('keeps the usual wording for everything else', () => {
    expect(addonErrorMessage(new XtreamRequestError('timeout', errors.kinds.timeout))).toBe(errors.kinds.timeout)
    expect(addonErrorMessage({ kind: 'http', status: 500, message: 'x', retryable: true })).toBe(errors.kinds.httpRefused(500))
    expect(addonErrorMessage(new Error('boom'), 'Yüklenemedi')).toBe('Yüklenemedi')
  })
})
