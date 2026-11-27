import { describe, expect, it } from 'vitest'
import { mpvHeaderOptions, sanitizeStreamHttpHeaders } from './http-headers'

describe('stream request headers', () => {
  it('keeps a user agent, an http(s) referer and a bare origin', () => {
    const headers = { userAgent: ' VLC/3.0.20 (a, b; c) ', referer: 'https://site.example/p?x=1,2', origin: 'https://site.example:8443' }
    expect(sanitizeStreamHttpHeaders(headers)).toEqual({
      userAgent: 'VLC/3.0.20 (a, b; c)',
      referer: 'https://site.example/p?x=1,2',
      origin: 'https://site.example:8443'
    })
    expect(mpvHeaderOptions(headers)).toEqual({
      'user-agent': 'VLC/3.0.20 (a, b; c)',
      referrer: 'https://site.example/p?x=1,2',
      'http-header-fields': 'Origin: https://site.example:8443'
    })
  })

  it('refuses a value that could start another header or another list item', () => {
    // A line break in any value; a comma in the one mpv takes as a list.
    expect(sanitizeStreamHttpHeaders({ userAgent: 'UA\r\nCookie: a=b' })).toBeNull()
    expect(sanitizeStreamHttpHeaders({ referer: 'https://site.example/\nX-Evil: 1' })).toBeNull()
    expect(sanitizeStreamHttpHeaders({ origin: 'https://site.example,X-Evil: 1' })).toBeNull()
    expect(sanitizeStreamHttpHeaders({ origin: 'https://site.example/path' })).toBeNull()
    expect(mpvHeaderOptions({ origin: 'https://site.example,X-Evil: 1' })).toEqual({})
  })

  it('refuses what is not a header value at all', () => {
    expect(sanitizeStreamHttpHeaders(null)).toBeNull()
    expect(sanitizeStreamHttpHeaders('UA')).toBeNull()
    expect(sanitizeStreamHttpHeaders({ userAgent: 42, referer: 'javascript:alert(1)', origin: '' })).toBeNull()
    expect(sanitizeStreamHttpHeaders({ userAgent: 'Türkçe UA' })).toBeNull()
    expect(sanitizeStreamHttpHeaders({ userAgent: 'x'.repeat(513) })).toBeNull()
    // Only the known three: anything else in the object is left out.
    expect(sanitizeStreamHttpHeaders({ userAgent: 'UA', cookie: 'a=b' })).toEqual({ userAgent: 'UA' })
  })
})
