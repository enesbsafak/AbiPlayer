import { describe, expect, it } from 'vitest'
import {
  assertMigrationOrder,
  PERSIST_MIGRATIONS,
  PERSIST_VERSION,
  runPersistMigrations,
  type PersistMigration
} from './persist-migrations'

const steps: PersistMigration[] = [
  { version: 1, name: 'a', migrate: (state) => ({ ...state, a: true }) },
  { version: 2, name: 'b', migrate: (state) => ({ ...state, b: true }) },
  { version: 3, name: 'c', migrate: (state) => ({ ...state, c: true }) }
]

describe('runPersistMigrations', () => {
  it('runs every step after the stored version, in order', () => {
    expect(runPersistMigrations({ x: 1 }, 1, steps)).toEqual({
      state: { x: 1, b: true, c: true },
      version: 3,
      failure: null,
      fromNewerVersion: false
    })
  })

  it('treats an unversioned payload as version 0', () => {
    expect(runPersistMigrations({}, Number.NaN, steps).state).toEqual({ a: true, b: true, c: true })
  })

  it('keeps the last good state when a step throws, and never throws itself', () => {
    const failing: PersistMigration[] = [
      steps[0],
      {
        version: 2,
        name: 'broken',
        migrate: (state) => {
          state.halfDone = true
          throw new Error('boom')
        }
      },
      steps[2]
    ]
    const input = { keep: 'me' }

    const outcome = runPersistMigrations(input, 0, failing)

    expect(outcome.state).toEqual({ keep: 'me', a: true })
    expect(outcome.version).toBe(1)
    expect(outcome.failure).toMatchObject({ version: 2, name: 'broken' })
    // The step worked on a copy: nothing it did before throwing leaks out.
    expect(input).toEqual({ keep: 'me' })
  })

  it('resumes from the last good version on the next run', () => {
    const first = runPersistMigrations({}, 0, [
      steps[0],
      { version: 2, name: 'broken', migrate: () => { throw new Error('boom') } }
    ])
    const second = runPersistMigrations(first.state, first.version, steps)
    expect(second.state).toEqual({ a: true, b: true, c: true })
    expect(second.version).toBe(3)
  })

  it('leaves state from a newer version untouched instead of truncating it', () => {
    const newer = { settings: { future: 1 }, somethingNew: [1, 2] }
    const outcome = runPersistMigrations(newer, 9, steps)
    expect(outcome.fromNewerVersion).toBe(true)
    expect(outcome.state).toBe(newer)
    expect(outcome.version).toBe(9)
  })

  it('rejects a step that returns something other than an object', () => {
    const outcome = runPersistMigrations({}, 0, [
      { version: 1, name: 'bad', migrate: () => null as unknown as Record<string, unknown> }
    ])
    expect(outcome.failure?.name).toBe('bad')
    expect(outcome.version).toBe(0)
  })
})

describe('migration list', () => {
  it('is numbered 1, 2, 3, ... and ends at PERSIST_VERSION', () => {
    expect(() => assertMigrationOrder(PERSIST_MIGRATIONS)).not.toThrow()
    expect(PERSIST_VERSION).toBe(PERSIST_MIGRATIONS.length)
    expect(() => assertMigrationOrder([steps[0], steps[2]])).toThrow()
  })

  it('v1 moves the watch history to media keys', () => {
    const outcome = runPersistMigrations(
      {
        sources: [{ id: 'xt', type: 'xtream', name: 'X', addedAt: 1 }],
        watchProgress: [
          {
            key: 'http://h/movie/~abi~/~abi~/55.mkv',
            position: 700,
            duration: 3600,
            updatedAt: 1,
            channel: { id: 'o', name: 'Film', streamUrl: 'http://h/movie/~abi~/~abi~/55.mkv', sourceId: 'xt', type: 'vod' }
          }
        ]
      },
      0
    )
    expect(outcome.failure).toBeNull()
    expect((outcome.state.watchProgress as Array<{ key: string }>)[0].key).toBe('movie:xt:55')
  })
})

describe('strip-m3u-entry-urls (v3, F3-02)', () => {
  const v2Payload = {
    sources: [{ id: 'm', name: 'Liste', type: 'm3u_url', url: 'http://panel.test/get.php?username=ali&password=s3cret', addedAt: 1 }],
    favoriteIds: ['m_m3u_ch_1', 'x_live_2'],
    favoriteSnapshots: [
      { id: 'm_m3u_ch_1', name: 'Film', sourceId: 'm', type: 'vod', streamUrl: 'http://panel.test/movie/ali/s3cret/7.mkv' },
      { id: 'x_live_2', name: 'Kanal', sourceId: 'x', type: 'live', streamId: 2 }
    ],
    watchProgress: [
      {
        key: 'm3u:m:abc',
        target: { kind: 'm3u', sourceId: 'm', entryId: 'abc', mediaType: 'vod' },
        position: 100,
        duration: 3600,
        updatedAt: 1,
        channel: { id: 'm_m3u_ch_1', name: 'Film', streamUrl: 'http://panel.test/movie/ali/s3cret/7.mkv', sourceId: 'm', type: 'vod' }
      }
    ]
  }

  it('takes every entry URL out of history and favourites, and leaves the source URL for the runtime move', () => {
    const outcome = runPersistMigrations(v2Payload, 2)
    expect(outcome.version).toBe(PERSIST_VERSION)
    const state = outcome.state as typeof v2Payload
    expect(JSON.stringify({ ...state, sources: [] })).not.toContain('s3cret')
    expect(state.favoriteSnapshots[0]).toEqual({ id: 'm_m3u_ch_1', name: 'Film', sourceId: 'm', type: 'vod', m3u: true })
    expect(state.favoriteSnapshots[1]).toEqual(v2Payload.favoriteSnapshots[1])
    expect(state.watchProgress[0].channel.streamUrl).toBe('')
    // Copied to the secure store first, at runtime; dropped only once that worked.
    expect(state.sources[0].url).toBe(v2Payload.sources[0].url)
  })

  it('is idempotent', () => {
    const once = runPersistMigrations(v2Payload, 2).state
    expect(runPersistMigrations(once, 2).state).toEqual(once)
  })
})
