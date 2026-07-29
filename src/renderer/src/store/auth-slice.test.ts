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
