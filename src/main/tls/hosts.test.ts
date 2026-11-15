// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  endpointKey,
  GITHUB_HOSTS,
  isGithubHost,
  isNeverRelaxableHost,
  normalizeHost,
  normalizePort,
  tlsEndpointOf
} from './hosts'

describe('normalizeHost', () => {
  it('lower-cases, drops trailing dots and converts IDN to punycode', () => {
    expect(normalizeHost('IPTV.Example.COM')).toBe('iptv.example.com')
    expect(normalizeHost('iptv.example.com.')).toBe('iptv.example.com')
    expect(normalizeHost('Bücher.Example')).toBe('xn--bcher-kva.example')
    expect(normalizeHost('xn--bcher-kva.example')).toBe('xn--bcher-kva.example')
  })

  it('keeps IP literals and strips IPv6 brackets', () => {
    expect(normalizeHost('127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeHost('[::1]')).toBe('::1')
    expect(normalizeHost('[FE80::1]')).toBe('fe80::1')
  })

  it('rejects what is not a host', () => {
    expect(normalizeHost('')).toBeNull()
    expect(normalizeHost('   ')).toBeNull()
    expect(normalizeHost(42)).toBeNull()
    expect(normalizeHost('a b')).toBeNull()
  })
})

describe('normalizePort', () => {
  it('accepts 1-65535 as number or digit string', () => {
    expect(normalizePort(443)).toBe(443)
    expect(normalizePort('8443')).toBe(8443)
    expect(normalizePort(0)).toBeNull()
    expect(normalizePort(65536)).toBeNull()
    expect(normalizePort(1.5)).toBeNull()
    expect(normalizePort('80a')).toBeNull()
  })
})

describe('tlsEndpointOf', () => {
  it('gives host and real port of https URLs only', () => {
    expect(tlsEndpointOf('https://Panel.Example:8443/player_api.php?u=x')).toEqual({ host: 'panel.example', port: 8443 })
    expect(tlsEndpointOf('https://panel.example/')).toEqual({ host: 'panel.example', port: 443 })
    expect(tlsEndpointOf('https://bücher.example/live/a.ts')).toEqual({ host: 'xn--bcher-kva.example', port: 443 })
    expect(tlsEndpointOf('https://[::1]:9000/x')).toEqual({ host: '::1', port: 9000 })
    expect(tlsEndpointOf('http://panel.example/')).toBeNull()
    expect(tlsEndpointOf('not a url')).toBeNull()
  })

  it('keys IPv6 endpoints unambiguously', () => {
    expect(endpointKey({ host: '::1', port: 443 })).toBe('[::1]:443')
    expect(endpointKey({ host: 'panel.example', port: 443 })).toBe('panel.example:443')
  })
})

describe('never-relaxable hosts', () => {
  it('keeps the update hosts that were strict before', () => {
    expect([...GITHUB_HOSTS].sort()).toEqual([
      'api.github.com',
      'codeload.github.com',
      'github.com',
      'objects.githubusercontent.com',
      'raw.githubusercontent.com',
      'release-assets.githubusercontent.com'
    ])
    for (const host of GITHUB_HOSTS) expect(isNeverRelaxableHost(host)).toBe(true)
    expect(isGithubHost('anything.githubusercontent.com')).toBe(true)
  })

  it('covers TMDB, in any spelling', () => {
    expect(isNeverRelaxableHost('api.themoviedb.org')).toBe(true)
    expect(isNeverRelaxableHost('API.TheMovieDB.org.')).toBe(true)
    expect(isNeverRelaxableHost('image.tmdb.org')).toBe(true)
  })

  it('does not cover look-alikes or provider hosts', () => {
    expect(isNeverRelaxableHost('github.com.evil.example')).toBe(false)
    expect(isNeverRelaxableHost('notgithub.com')).toBe(false)
    expect(isNeverRelaxableHost('panel.example')).toBe(false)
  })

  it('treats an unparseable host as never relaxable', () => {
    expect(isNeverRelaxableHost('')).toBe(true)
  })
})
