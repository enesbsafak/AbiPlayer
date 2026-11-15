import { migrateProgressEntriesToMediaKeys, stripStoredEntryUrls } from '@/services/watch-progress'
import { stripSnapshotStreamUrls } from './favorites-slice'

/** The persisted payload's `state`, as read back: untrusted, any shape. */
export type PersistedRecord = Record<string, unknown>

/**
 * One step of the persisted-state schema.
 *
 * Rules for adding one (append to `PERSIST_MIGRATIONS`, never reorder or edit a
 * released step):
 * - `version` is the version the step produces: the previous last version + 1.
 * - `migrate` gets a private deep copy and returns the new state. It must not
 *   assume a key exists or has the expected type: the payload may be hand
 *   edited or written by a broken build.
 * - It must be idempotent. When a later step fails, the state is written back
 *   labelled with the last version that succeeded, and every step after that
 *   runs again on the next start, on data that may already have its shape.
 * - Throwing is safe: the steps before it are kept, the failing one and the
 *   rest are retried next start, and a copy of the stored payload is kept.
 * - Validation of the final shape stays in `merge` (store/index.ts), which
 *   runs on every load whether or not a migration ran.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * Snapshots for favourites that have none, taken from watch-history entries of
 * the same item (they hold its name, artwork and playback target). Shape is
 * checked again by `sanitizeFavoriteSnapshot` when the state is merged.
 */
export function seedFavoriteSnapshots(favoriteIds: unknown, existing: unknown, watchProgress: unknown): unknown[] {
  const kept = Array.isArray(existing) ? existing : []
  if (!Array.isArray(favoriteIds) || !Array.isArray(watchProgress)) return kept

  const covered = new Set<string>()
  for (const snapshot of kept) {
    const id = asRecord(snapshot)?.id
    if (typeof id === 'string') covered.add(id)
  }
  const wanted = new Set<string>()
  for (const id of favoriteIds) if (typeof id === 'string' && !covered.has(id)) wanted.add(id)
  if (wanted.size === 0) return kept

  const seeded: Record<string, unknown>[] = []
  for (const raw of watchProgress) {
    const entry = asRecord(raw)
    const channel = asRecord(entry?.channel)
    const target = asRecord(entry?.target)
    if (!channel || !target || typeof channel.id !== 'string' || !wanted.has(channel.id)) continue

    const snapshot: Record<string, unknown> = {
      id: channel.id,
      name: channel.name,
      sourceId: channel.sourceId,
      type: channel.type
    }
    for (const key of ['logo', 'coverUrl', 'categoryName'] as const) {
      if (typeof channel[key] === 'string') snapshot[key] = channel[key]
    }
    if (target.kind === 'live') {
      snapshot.streamId = target.streamId
    } else if (target.kind === 'movie') {
      snapshot.streamId = target.streamId
      snapshot.containerExtension = target.containerExtension
    } else if (target.kind === 'm3u' && typeof channel.streamUrl === 'string') {
      snapshot.streamUrl = channel.streamUrl
    } else {
      continue
    }
    seeded.push(snapshot)
    wanted.delete(channel.id)
  }
  return seeded.length > 0 ? [...kept, ...seeded] : kept
}

export interface PersistMigration {
  version: number
  name: string
  migrate: (state: PersistedRecord) => PersistedRecord
}

export const PERSIST_MIGRATIONS: readonly PersistMigration[] = [
  {
    // History used to be keyed by the stream URL with the credentials
    // redacted, which merged two accounts on one host and hid M3U entries
    // with Xtream-looking URLs. Entries that cannot be mapped are kept.
    version: 1,
    name: 'watch-progress-media-keys',
    migrate: (state) => ({
      ...state,
      watchProgress: migrateProgressEntriesToMediaKeys(state.watchProgress, state.sources)
    })
  },
  {
    // Favourites used to be bare ids, rendered only once their catalog was in
    // memory. Each now carries a snapshot; favourites that were watched get
    // theirs from the history entry, the rest when they are next toggled.
    version: 2,
    name: 'favorite-snapshots',
    migrate: (state) => ({
      ...state,
      favoriteSnapshots: seedFavoriteSnapshots(state.favoriteIds, state.favoriteSnapshots, state.watchProgress)
    })
  },
  {
    // M3U entry URLs (usually holding the account password, like the Xtream
    // URLs they are generated from) left history and favourite snapshots: the
    // entry is found again in the loaded playlist by its id. The playlist URL
    // of the source itself moves to the secure store at runtime
    // (useAutoConnect), since that needs a write that can fail.
    version: 3,
    name: 'strip-m3u-entry-urls',
    migrate: (state) => ({
      ...state,
      watchProgress: stripStoredEntryUrls(state.watchProgress),
      favoriteSnapshots: stripSnapshotStreamUrls(state.favoriteSnapshots)
    })
  }
]

export function latestPersistVersion(migrations: readonly PersistMigration[]): number {
  return migrations.length > 0 ? migrations[migrations.length - 1].version : 0
}

/** Versions must start at 1 and go up by one; anything else is a programming error. */
export function assertMigrationOrder(migrations: readonly PersistMigration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Persist migration "${migration.name}" has version ${migration.version}, expected ${index + 1}`
      )
    }
  })
}

assertMigrationOrder(PERSIST_MIGRATIONS)

export const PERSIST_VERSION = latestPersistVersion(PERSIST_MIGRATIONS)

export interface MigrationFailure {
  version: number
  name: string
  error: unknown
}

export interface MigrationOutcome {
  state: PersistedRecord
  /** The version `state` is at. Lower than the target when a step failed. */
  version: number
  failure: MigrationFailure | null
  /** Written by a newer build: returned untouched, not migrated. */
  fromNewerVersion: boolean
}

function isRecord(value: unknown): value is PersistedRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function copyOf(state: PersistedRecord): PersistedRecord {
  return JSON.parse(JSON.stringify(state)) as PersistedRecord
}

/**
 * Runs every step after `fromVersion`, in order. Never throws: a failing step
 * stops the run and the state of the last good step is returned with it.
 */
export function runPersistMigrations(
  raw: unknown,
  fromVersion: number,
  migrations: readonly PersistMigration[] = PERSIST_MIGRATIONS
): MigrationOutcome {
  const latest = latestPersistVersion(migrations)
  const start = Number.isInteger(fromVersion) && fromVersion > 0 ? fromVersion : 0
  let state: PersistedRecord = isRecord(raw) ? raw : {}

  if (start > latest) {
    return { state, version: start, failure: null, fromNewerVersion: true }
  }

  let version = start
  for (const migration of migrations) {
    if (migration.version <= version) continue
    try {
      const next = migration.migrate(copyOf(state))
      if (!isRecord(next)) throw new Error('migration did not return an object')
      state = next
      version = migration.version
    } catch (error) {
      return {
        state,
        version,
        failure: { version: migration.version, name: migration.name, error },
        fromNewerVersion: false
      }
    }
  }

  return { state, version, failure: null, fromNewerVersion: false }
}
