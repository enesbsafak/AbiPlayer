import { describe, expect, it } from 'vitest'
import { redactStoredCopy } from './stored-copy-redaction'

const PLAYLIST = 'http://panel.example/get.php?username=ahmet&password=s3cret&type=m3u_plus'

const payload = JSON.stringify({
  state: {
    sources: [
      { id: 'xt', name: 'Panel', type: 'xtream', url: 'http://panel.example', username: 'ahmet', password: 's3cret', addedAt: 1 },
      { id: 'mu', name: 'Liste', type: 'm3u_url', url: 'http://cdn.example/lists/tok3n-abc.m3u', addedAt: 1 },
      { id: 'mq', name: 'Liste 2', type: 'm3u_url', url: PLAYLIST, addedAt: 1 }
    ],
    settings: { tmdbApiKey: 'tmdb-key-123', epgRefreshInterval: 30 },
    favoriteIds: ['a'],
    favoriteSnapshots: [{ id: 'a', name: 'Kanal', sourceId: 'mu', type: 'live', streamUrl: 'http://cdn.example/lists/1.ts' }],
    watchProgress: [
      {
        key: 'http://panel.example/movie/ahmet/s3cret/55.mkv',
        position: 10,
        channel: { id: 'o', name: 'Film', streamUrl: 'http://panel.example/movie/ahmet/s3cret/55.mkv', sourceId: 'xt', type: 'vod' }
      }
    ]
  },
  version: 1
})

describe('redactStoredCopy (K10)', () => {
  it('drops every secret the persisted payload can hold and keeps the rest for recovery', () => {
    const redacted = redactStoredCopy(payload)
    for (const secret of ['s3cret', 'ahmet', 'tok3n', 'tmdb-key-123', 'get.php?username=ahmet']) {
      expect(redacted).not.toContain(secret)
    }
    const state = JSON.parse(redacted).state
    expect(state.sources.map((source: { id: string }) => source.id)).toEqual(['xt', 'mu', 'mq'])
    expect(state.sources[0]).toMatchObject({ name: 'Panel', url: 'http://panel.example' })
    expect(state.sources[1]).not.toHaveProperty('url')
    expect(state.settings).toEqual({ epgRefreshInterval: 30 })
    expect(state.favoriteSnapshots[0]).toMatchObject({ id: 'a', name: 'Kanal', streamUrl: '' })
    expect(state.watchProgress[0]).toMatchObject({ position: 10, channel: { name: 'Film', streamUrl: '' } })
  })

  it('is idempotent', () => {
    const once = redactStoredCopy(payload)
    expect(redactStoredCopy(once)).toBe(once)
  })

  it('masks text that is not JSON', () => {
    expect(redactStoredCopy(`{broken ${PLAYLIST}`)).not.toContain('s3cret')
  })
})
