// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  isValidCredential,
  isValidM3uSecret,
  isValidSourceSecret,
  MAX_SECURE_M3U_URL_LENGTH,
  sanitizeCredentialMap
} from './secure-credentials'

const XTREAM = { url: 'http://p.example', username: 'ali', password: 's3cret' }
const M3U = { kind: 'm3u_url', url: 'http://p.example/get.php?username=ali&password=s3cret' }

describe('secure source secrets (F3-02)', () => {
  it('accepts both shapes and copies only their own fields', () => {
    expect(
      sanitizeCredentialMap({
        xt: { ...XTREAM, extra: 1 },
        mu: { ...M3U, username: 'x' },
        bad: { kind: 'm3u_url', url: 'javascript:alert(1)' }
      })
    ).toEqual({ xt: XTREAM, mu: M3U })
  })

  it('keeps the Xtream validator strict', () => {
    expect(isValidCredential(XTREAM)).toBe(true)
    expect(isValidCredential({ ...XTREAM, password: '' })).toBe(false)
    expect(isValidCredential({ url: 'ftp://p', username: 'a', password: 'b' })).toBe(false)
  })

  it('accepts only an http(s) M3U URL without spaces and of sane length', () => {
    expect(isValidM3uSecret(M3U)).toBe(true)
    expect(isValidM3uSecret({ kind: 'm3u_url', url: 'http://p.example/a b.m3u' })).toBe(false)
    expect(isValidM3uSecret({ kind: 'm3u_url', url: `http://p.example/${'a'.repeat(MAX_SECURE_M3U_URL_LENGTH)}` })).toBe(false)
    expect(isValidM3uSecret({ kind: 'other', url: M3U.url })).toBe(false)
  })

  it('never lets a malformed M3U secret pass as Xtream credentials', () => {
    expect(isValidSourceSecret({ kind: 'm3u', ...XTREAM })).toBe(false)
    expect(isValidSourceSecret(XTREAM)).toBe(true)
    expect(isValidSourceSecret(M3U)).toBe(true)
    expect(isValidSourceSecret(null)).toBe(false)
  })
})
