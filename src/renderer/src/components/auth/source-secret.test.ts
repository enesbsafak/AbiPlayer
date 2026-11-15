import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPartialize, useStore, type AppStore } from '@/store'
import type { PlaylistSource } from '@/types/playlist'
import { credentialLossMessage } from './CredentialNotice'
import { normalizeSecretInput, saveSourceSecret } from './source-secret'

const xtream: PlaylistSource = { id: 'xt', name: 'Panel', type: 'xtream', url: 'http://panel.test', addedAt: 1 }
const m3u: PlaylistSource = { id: 'mu', name: 'Liste', type: 'm3u_url', addedAt: 1 }

afterEach(() => {
  useStore.setState({
    sources: [],
    sourceErrors: {},
    favoriteIds: new Set(),
    favoriteSnapshots: {},
    legacySecretSourceIds: [],
    connectRetryToken: 0
  })
})

describe('entering a source secret again in place (K3)', () => {
  it('checks and normalizes what was typed, like the add forms', () => {
    expect(normalizeSecretInput(xtream, { url: 'panel.test:8080/', username: ' ali ', password: ' s3cret ' })).toEqual({
      ok: true,
      secret: { url: 'http://panel.test:8080', username: 'ali', password: 's3cret' }
    })
    expect(normalizeSecretInput(xtream, { url: 'http://panel.test', username: 'ali', password: '' })).toMatchObject({ ok: false })
    expect(normalizeSecretInput(m3u, { url: 'cdn.test/list.m3u' })).toEqual({ ok: true, secret: { m3uUrl: 'http://cdn.test/list.m3u' } })
    expect(normalizeSecretInput(m3u, { url: '  ' })).toEqual({ ok: false, error: 'Liste adresi boş bırakılamaz' })
    const other: PlaylistSource = { id: 'm2', name: 'Diğer', type: 'm3u_url', url: 'http://cdn.test/list.m3u', addedAt: 1 }
    expect(normalizeSecretInput(m3u, { url: 'http://cdn.test/list.m3u' }, [m3u, other])).toEqual({
      ok: false,
      error: 'Bu URL zaten "Diğer" olarak ekli'
    })
  })

  it('stores the secret first, keeps the source id (and so its favourites) and connects it again', async () => {
    useStore.setState({
      sources: [xtream, m3u],
      favoriteIds: new Set(['xt_live_1']),
      sourceErrors: { xt: { kind: 'missing-secret', message: 'yok', retryAt: null } },
      connectRetryToken: 4
    })
    const setXtream = vi.fn().mockResolvedValue(undefined)

    await saveSourceSecret('xt', { url: 'http://panel.test', username: 'ali', password: 's3cret' }, { setXtream })

    expect(setXtream).toHaveBeenCalledWith('xt', { url: 'http://panel.test', username: 'ali', password: 's3cret' })
    const state = useStore.getState()
    expect(state.sources.map((source) => source.id)).toEqual(['xt', 'mu'])
    expect(state.getXtreamCredentials('xt')).toEqual({ url: 'http://panel.test', username: 'ali', password: 's3cret' })
    expect(state.favoriteIds).toEqual(new Set(['xt_live_1']))
    expect(state.sourceErrors).toEqual({})
    expect(state.connectRetryToken).toBe(5)
    // Not written to localStorage: the secure store has it.
    expect(JSON.stringify(createPartialize()(state as AppStore))).not.toContain('s3cret')
  })

  it('changes nothing when the secure write fails', async () => {
    useStore.setState({ sources: [m3u], connectRetryToken: 0 })
    const setM3uUrl = vi.fn().mockRejectedValue(new Error('yazılamadı'))
    await expect(saveSourceSecret('mu', { m3uUrl: 'http://cdn.test/list.m3u' }, { setM3uUrl })).rejects.toThrow('yazılamadı')
    expect(useStore.getState().sources[0]).not.toHaveProperty('url')
    expect(useStore.getState().connectRetryToken).toBe(0)
  })

  it('no longer tells the user to delete and re-add sources after a credential loss', () => {
    const message = credentialLossMessage({ lostAt: 1, reason: 'decrypt-failed', quarantinedAs: null })
    expect(message).not.toMatch(/silip/)
    expect(message).toMatch(/Bilgileri Gir/)
  })
})
