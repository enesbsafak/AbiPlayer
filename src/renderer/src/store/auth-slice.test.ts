import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createAuthSlice, type AuthSlice } from './auth-slice'

function createTestStore() {
  return create<AuthSlice>()((...args) => createAuthSlice(...args))
}

describe('auth-slice reconnect requests', () => {
  it('bumps the retry token so useAutoConnect can bypass its cooldown', () => {
    const store = createTestStore()

    expect(store.getState().connectRetryToken).toBe(0)

    store.getState().requestSourceReconnect()
    expect(store.getState().connectRetryToken).toBe(1)

    store.getState().requestSourceReconnect()
    expect(store.getState().connectRetryToken).toBe(2)
  })

  it('clears the previous connection error when a retry is requested', () => {
    const store = createTestStore()

    store.getState().setAuthError('Kaynak A: Kimlik doğrulama başarısız')
    expect(store.getState().error).not.toBeNull()

    store.getState().requestSourceReconnect()

    // The error banner must disappear immediately, otherwise the retry screen
    // keeps showing the stale failure while the new attempt is running.
    expect(store.getState().error).toBeNull()
  })
})

describe('auth-slice source state', () => {
  it('updates a source in place, keeping its position', () => {
    const store = createTestStore()
    store.getState().addSource({ id: 'a', name: 'A', type: 'm3u_file', filePath: '/listeler/a.m3u', addedAt: 1 })
    store.getState().addSource({ id: 'b', name: 'B', type: 'm3u_file', filePath: '/listeler/b.m3u', addedAt: 2 })
    store.getState().updateSource('a', { filePath: '/yeni/a.m3u' })
    expect(store.getState().sources.map((source) => [source.id, source.filePath])).toEqual([
      ['a', '/yeni/a.m3u'],
      ['b', '/listeler/b.m3u']
    ])
  })

  it('forgets the errors and pending migration of a removed source', () => {
    const store = createTestStore()
    store.getState().addSource({ id: 'a', name: 'A', type: 'xtream', addedAt: 1 })
    store.setState({ legacySecretSourceIds: ['a'] })
    store.getState().setSourceError('a', { kind: 'other', message: 'x', retryAt: 1 })
    store.getState().removeSource('a')
    expect(store.getState().sourceErrors).toEqual({})
    expect(store.getState().legacySecretSourceIds).toEqual([])
  })

  it('puts stored M3U URLs and Xtream credentials on their sources', () => {
    const store = createTestStore()
    store.getState().addSource({ id: 'x', name: 'X', type: 'xtream', url: 'http://p', addedAt: 1 })
    store.getState().addSource({ id: 'm', name: 'M', type: 'm3u_url', addedAt: 1 })
    store.getState().hydrateSourceSecrets({
      xtream: { x: { url: 'http://p', username: 'u', password: 'p' } },
      m3uUrls: { m: 'http://p/get.php' }
    })
    expect(store.getState().sources.map((source) => source.url)).toEqual(['http://p', 'http://p/get.php'])
    expect(store.getState().sources[0]?.password).toBe('p')
    expect(store.getState().credentialsHydrated).toBe(true)
  })
})
