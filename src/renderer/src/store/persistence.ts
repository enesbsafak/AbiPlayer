import type { PersistStorage, StorageValue } from 'zustand/middleware'

/** Where the serialized store lives (localStorage, with the update backup behind it). */
export interface PersistBackend {
  getItem(name: string): string | null | Promise<string | null>
  setItem(name: string, value: string): void
  removeItem(name: string): void
}

/** Synchronous key-value storage for side copies (recovery snapshots). */
export interface SideStorage {
  getItem(name: string): string | null
  setItem(name: string, value: string): void
}

export interface PersistTimers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
  now(): number
}

const defaultTimers: PersistTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now()
}

/** Quiet time after the last change before it is written. */
export const PERSIST_WRITE_DELAY_MS = 250
/** A change never waits longer than this, however often the state keeps changing. */
export const PERSIST_MAX_WRITE_DELAY_MS = 1_000

export interface PersistControllerOptions {
  name: string
  backend: PersistBackend
  /** Where `preserveStoredCopy` writes; must not fall back to anything. */
  sideStorage: SideStorage
  delayMs?: number
  maxDelayMs?: number
  timers?: PersistTimers
}

export interface PersistController<S> {
  /** Hand this to zustand's `persist` as `storage`. */
  storage: PersistStorage<S>
  /** Writes a pending change now. */
  flush(): void
  hasPendingWrite(): boolean
  /** A (re)hydration has started: write what is pending, then hold writes until `markHydrated`. */
  beginHydration(): void
  /**
   * Hydration is over: writes are allowed from now on. `storedState` is the
   * partialized state that matches what storage already holds, so it is not
   * written back; undefined when nothing usable was loaded.
   */
  markHydrated(storedState: S | undefined): void
  /** While on (the page is going away), every change is written at once. */
  setImmediate(on: boolean): void
  /** Version stamped on written payloads instead of zustand's (null: zustand's). */
  setWriteVersion(version: number | null): void
  /** Copies the payload read at hydration to `<name>:<suffix>`, unless that key exists. */
  preserveStoredCopy(suffix: string): void
  setBackend(backend: PersistBackend, sideStorage?: SideStorage): void
}

/**
 * The store's storage layer. zustand calls `setItem` after every `set()`; this
 * writes only when the persisted part of the state actually changed (by
 * identity: the partialize function must return the same object for unchanged
 * input) and coalesces bursts into one trailing write, at most
 * `maxDelayMs` after the first change. Serialization happens at write time.
 *
 * Nothing is written before hydration has finished: until then the state is
 * the defaults, and writing them could only overwrite what is being loaded.
 */
export function createPersistController<S>(options: PersistControllerOptions): PersistController<S> {
  const { name } = options
  const delayMs = options.delayMs ?? PERSIST_WRITE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? PERSIST_MAX_WRITE_DELAY_MS
  const timers = options.timers ?? defaultTimers
  let backend = options.backend
  let sideStorage = options.sideStorage

  let hydrated = false
  let immediate = false
  let writeVersion: number | null = null
  let lastRawRead: string | null = null
  let lastWrittenState: S | null = null
  let pending: StorageValue<S> | null = null
  let firstPendingAt: number | null = null
  let timer: unknown = null

  const cancelTimer = (): void => {
    if (timer !== null) timers.clear(timer)
    timer = null
  }

  const writeNow = (): void => {
    cancelTimer()
    const value = pending
    pending = null
    firstPendingAt = null
    if (!value) return
    let serialized: string
    try {
      serialized = JSON.stringify({ state: value.state, version: writeVersion ?? value.version })
    } catch (error) {
      console.warn('[store] persisted state could not be serialized:', error)
      return
    }
    backend.setItem(name, serialized)
    lastWrittenState = value.state
  }

  const schedule = (): void => {
    const now = timers.now()
    if (firstPendingAt === null) firstPendingAt = now
    const wait = Math.max(0, Math.min(delayMs, firstPendingAt + maxDelayMs - now))
    cancelTimer()
    timer = timers.set(writeNow, wait)
  }

  const parse = (raw: string | null): StorageValue<S> | null => {
    lastRawRead = raw
    if (raw === null) return null
    try {
      return JSON.parse(raw) as StorageValue<S>
    } catch (error) {
      // Unreadable: start from defaults, but keep the text for recovery.
      console.warn('[store] persisted state is not valid JSON; keeping a copy and starting fresh:', error)
      preserveStoredCopy('unreadable')
      return null
    }
  }

  function preserveStoredCopy(suffix: string): void {
    if (lastRawRead === null) return
    const key = `${name}:${suffix}`
    if (sideStorage.getItem(key) !== null) return
    sideStorage.setItem(key, lastRawRead)
  }

  const storage: PersistStorage<S> = {
    getItem: (key) => {
      const raw = backend.getItem(key)
      if (raw instanceof Promise) return raw.then(parse)
      return parse(raw)
    },
    setItem: (_key, value) => {
      if (!hydrated) return
      if (value.state === lastWrittenState && pending === null) return
      if (pending && value.state === pending.state) return
      if (value.state === lastWrittenState) {
        // Back to what is already stored: nothing left to write.
        pending = null
        firstPendingAt = null
        cancelTimer()
        return
      }
      pending = value
      if (immediate) writeNow()
      else schedule()
    },
    removeItem: (key) => {
      pending = null
      firstPendingAt = null
      cancelTimer()
      lastWrittenState = null
      backend.removeItem(key)
    }
  }

  return {
    storage,
    flush: writeNow,
    hasPendingWrite: () => pending !== null,
    beginHydration() {
      // A change made before a re-read must not be lost to it.
      writeNow()
      hydrated = false
    },
    markHydrated(storedState) {
      hydrated = true
      lastWrittenState = storedState ?? null
    },
    setImmediate(on) {
      immediate = on
      if (on) writeNow()
    },
    setWriteVersion(version) {
      writeVersion = version
    },
    preserveStoredCopy,
    setBackend(next, nextSideStorage) {
      backend = next
      if (nextSideStorage) sideStorage = nextSideStorage
    }
  }
}
