import { describe, expect, it } from 'vitest'
import { credentialsInUrl, maskCredentials } from './mask-credentials'

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

  // Regression (M2): M3U exports of Xtream panels list live streams as
  // http://host:port/<user>/<pass>/<id>, without /live/.
  describe('the Xtream live form without /live/', () => {
    it('masks it with no extension, .ts or .m3u8', () => {
      expect(maskCredentials('http://h.example:8080/alice/s3cret/12345: Server returned 404 Not Found')).toBe(
        'http://h.example:8080/***/***/12345: Server returned 404 Not Found'
      )
      expect(maskCredentials('http://h.example:8080/alice/s3cret/12345.ts')).toBe('http://h.example:8080/***/***/12345.ts')
      expect(maskCredentials('https://h.example/alice/s3cret/7.m3u8?token=1')).toBe('https://h.example/***/***/7.m3u8?token=1')
    })

    it('masks realistic ffprobe error output', () => {
      const stderr = [
        '[tcp @ 000001f3c2a4e0c0] Connection to tcp://h.example:8080 failed: Error number -138 occurred',
        'http://h.example:8080/alice/s3cret/12345: Error number -138 occurred'
      ].join('\n')
      expect(maskCredentials(stderr)).toBe(
        [
          '[tcp @ 000001f3c2a4e0c0] Connection to tcp://h.example:8080 failed: Error number -138 occurred',
          'http://h.example:8080/***/***/12345: Error number -138 occurred'
        ].join('\n')
      )

      const notFound =
        '[http @ 0000020b5c4e8b40] HTTP error 404 Not Found\nhttp://h.example:8080/alice/s3cret/12345.ts: Server returned 404 Not Found'
      const masked = maskCredentials(notFound)
      expect(masked).not.toContain('alice')
      expect(masked).not.toContain('s3cret')
      expect(masked).toContain('/***/***/12345.ts: Server returned 404 Not Found')
    })

    it('masks realistic ffmpeg error output, including a URL that ends a sentence', () => {
      const stderr = [
        "[hls @ 000001d8a6b0e3c0] Opening 'http://h.example:8080/alice/s3cret/12345.m3u8' for reading",
        '[in#0 @ 000001d8a6b0d2c0] Error opening input: Server returned 403 Forbidden (access denied)',
        'Error opening input file http://h.example:8080/alice/s3cret/12345.ts.',
        'Error opening input files: Server returned 403 Forbidden (access denied)'
      ].join('\n')
      const masked = maskCredentials(stderr)
      expect(masked).not.toContain('alice')
      expect(masked).not.toContain('s3cret')
      expect(masked).toContain("Opening 'http://h.example:8080/***/***/12345.m3u8' for reading")
      expect(masked).toContain('Error opening input file http://h.example:8080/***/***/12345.ts.\n')
      expect(masked).toContain('Server returned 403 Forbidden (access denied)')
    })

    it('leaves ordinary URLs with two segments and a number alone', () => {
      for (const url of [
        'https://api.github.com/repos/owner/repo/releases/123',
        'https://example.com/blog/2024/05/12345',
        'https://example.com/news/item/12345.html',
        'https://example.com/news/item/12345.html.',
        'https://example.com/a/b/123/details',
        'https://cdn.example.com/static/v2/123.js',
        'see /alice/s3cret/12345 in the docs',
        'Stream #0:1/2/3 skipped'
      ]) {
        expect(maskCredentials(url)).toBe(url)
      }
    })
  })

  describe('known secrets', () => {
    it('masks them wherever they appear as a URL part', () => {
      const stderr =
        '[http @ 0x1] Redirecting to http://edge.example/hls/alice/s3cret/abc/seg-1.ts\nhttp://edge.example/hls/alice/s3cret/abc/seg-1.ts: Server returned 403 Forbidden'
      expect(maskCredentials(stderr)).toContain('alice')
      const masked = maskCredentials(stderr, ['alice', 's3cret'])
      expect(masked).not.toContain('alice')
      expect(masked).not.toContain('s3cret')
      expect(masked).toContain('http://edge.example/hls/***/***/abc/seg-1.ts: Server returned 403 Forbidden')
    })

    it('does not mask a known secret inside ordinary words', () => {
      expect(maskCredentials('Server returned 404 Not Found', ['Not', 'Found'])).toBe('Server returned 404 Not Found')
      expect(maskCredentials('tvplus failed', ['tv'])).toBe('tvplus failed')
      expect(maskCredentials('x', ['', '***'])).toBe('x')
    })

    it('escapes regular expression characters in a secret', () => {
      expect(maskCredentials('http://h.example/x/a.b+c/p(1)/seg.ts', ['a.b+c', 'p(1)'])).toBe(
        'http://h.example/x/***/***/seg.ts'
      )
      expect(maskCredentials('http://h.example/axb/5', ['a.b'])).toBe('http://h.example/axb/5')
    })
  })
})

describe('credentialsInUrl', () => {
  it('finds the account in every Xtream URL form', () => {
    expect(credentialsInUrl('http://h.example:8080/live/alice/s3cret/1.ts')).toEqual(['alice', 's3cret'])
    expect(credentialsInUrl('http://h.example:8080/alice/s3cret/12345')).toEqual(['alice', 's3cret'])
    expect(credentialsInUrl('http://h.example:8080/alice/s3cret/12345.mp4')).toEqual(['alice', 's3cret'])
    expect(
      credentialsInUrl('http://h.example/streaming/timeshift.php?username=alice&password=s%40cret&stream=5')
    ).toEqual(['alice', 's%40cret'])
    expect(credentialsInUrl('http://alice:s3cret@h.example/list.m3u')).toEqual(['alice', 's3cret'])
  })

  it('finds nothing in a URL without an account', () => {
    expect(credentialsInUrl('https://cdn.example/hls/channel/index.m3u8')).toEqual([])
    expect(credentialsInUrl('https://cdn.example/a/b/c/123')).toEqual([])
    expect(credentialsInUrl('not a url')).toEqual([])
  })
})
