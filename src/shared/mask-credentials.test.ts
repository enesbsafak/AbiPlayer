import { describe, expect, it } from 'vitest'
import { maskCredentials } from './mask-credentials'

describe('maskCredentials', () => {
  it('masks the Xtream path form for every stream type', () => {
    expect(maskCredentials('http://p.example:8080/live/ali/s3cret/123.ts')).toBe(
      'http://p.example:8080/live/***/***/123.ts'
    )
    expect(maskCredentials('https://p.example/movie/ali/s3cret/9.mkv')).toBe('https://p.example/movie/***/***/9.mkv')
    expect(maskCredentials('https://p.example/series/ali/s3cret/9.mp4')).toBe('https://p.example/series/***/***/9.mp4')
    expect(maskCredentials('http://p.example/timeshift/ali/s3cret/60/2026-01-01:10-00/5.ts')).toBe(
      'http://p.example/timeshift/***/***/60/2026-01-01:10-00/5.ts'
    )
  })

  it('masks username and password query parameters', () => {
    expect(
      maskCredentials('http://p.example/player_api.php?username=ali&password=s3cret&action=get_live_streams')
    ).toBe('http://p.example/player_api.php?username=***&password=***&action=get_live_streams')
  })

  it('masks URL userinfo', () => {
    expect(maskCredentials('http://ali:s3cret@p.example/list.m3u')).toBe('http://***@p.example/list.m3u')
  })

  // ffmpeg prints the input URL inside its own error text.
  it('masks URLs embedded in ffmpeg stderr', () => {
    const stderr =
      '[http @ 0x1] HTTP error 403 Forbidden\nhttp://p.example/movie/ali/s3cret/9.mkv: Server returned 403 Forbidden'
    const masked = maskCredentials(stderr)
    expect(masked).not.toContain('ali')
    expect(masked).not.toContain('s3cret')
    expect(masked).toContain('Server returned 403 Forbidden')
  })

  it('leaves text without credentials alone', () => {
    expect(maskCredentials('Yayın açılamadı')).toBe('Yayın açılamadı')
    expect(maskCredentials('https://image.tmdb.org/t/p/w500/a.jpg')).toBe('https://image.tmdb.org/t/p/w500/a.jpg')
  })
})
