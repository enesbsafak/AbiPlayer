import { describe, expect, it, vi } from 'vitest'
import { itemAt } from '../../../shared/checked'
import { createPersistController, type PersistBackend, type PersistTimers } from './persistence'

interface State {
  value: number
}

function fakeTimers(): PersistTimers & { advance(ms: number): void } {
  let now = 0
  let nextId = 1
  const pending = new Map<number, { at: number; callback: () => void }>()
  return {
    set(callback, ms) {
      const id = nextId++
      pending.set(id, { at: now + ms, callback })
      return id
    },
    clear(handle) {
      pending.delete(handle as number)
    },
    now: () => now,
    advance(ms) {
      const until = now + ms
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        pending.delete(due[0])
        now = due[1].at
        due[1].callback()
      }
      now = until
    }
  }
}

function setup(initial: string | null = null, redactCopy?: (raw: string) => string) {
  const disk = new Map<string, string>()
  if (initial !== null) disk.set('store', initial)
  const writes: string[] = []
  const backend: PersistBackend = {
    getItem: (name) => disk.get(name) ?? null,
    setItem: (name, value) => {
      if (name === 'store') writes.push(value)
      disk.set(name, value)
    },
    removeItem: (name) => void disk.delete(name)
  }
  const timers = fakeTimers()
  const controller = createPersistController<State>({
    name: 'store',
    backend,
    sideStorage: {
      getItem: (name) => disk.get(name) ?? null,
      setItem: (name, value) => void disk.set(name, value),
      removeItem: (name) => void disk.delete(name),
      keys: () => [...disk.keys()]
    },
    redactCopy,
    delayMs: 100,
    maxDelayMs: 400,
    timers
  })
  return { controller, disk, writes, timers }
}

const write = (controller: ReturnType<typeof setup>['controller'], state: State, version = 1) =>
  controller.storage.setItem('store', { state, version })

describe('persist controller', () => {
  it('writes nothing before hydration has finished', () => {
    const { controller, writes, timers } = setup()
    write(controller, { value: 1 })
    timers.advance(1000)
    controller.flush()
    expect(writes).toEqual([])
  })

  it('skips the write when the persisted state did not change identity', () => {
    const { controller, writes, timers } = setup()
    const loaded = { value: 1 }
    controller.markHydrated(loaded)

    // Playback ticks call setItem with the same partialized object.
    for (let i = 0; i < 50; i++) write(controller, loaded)
    timers.advance(1000)

    expect(writes).toEqual([])
  })

  it('coalesces a burst into one trailing write of the latest state', () => {
    const { controller, writes, timers } = setup()
    controller.markHydrated(undefined)

    write(controller, { value: 1 })
    timers.advance(50)
    write(controller, { value: 2 })
    timers.advance(50)
    write(controller, { value: 3 })
    expect(writes).toEqual([])

    timers.advance(100)
    expect(writes).toEqual([JSON.stringify({ state: { value: 3 }, version: 1 })])
  })

  it('never delays a change past the maximum, however often the state changes', () => {
    const { controller, writes, timers } = setup()
    controller.markHydrated(undefined)

    for (let i = 0; i < 10; i++) {
      write(controller, { value: i })
      timers.advance(60)
    }

    expect(writes.length).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(itemAt(writes, 0)).state.value).toBeLessThanOrEqual(6)
  })

  it('flushes a pending write on demand', () => {
    const { controller, writes } = setup()
    controller.markHydrated(undefined)

    write(controller, { value: 7 })
    expect(controller.hasPendingWrite()).toBe(true)
    controller.flush()

    expect(writes).toHaveLength(1)
    expect(controller.hasPendingWrite()).toBe(false)
    controller.flush()
    expect(writes).toHaveLength(1)
  })

  it('writes at once while the page is going away', () => {
    const { controller, writes } = setup()
    controller.markHydrated(undefined)
    write(controller, { value: 1 })

    controller.setImmediate(true)
    expect(writes).toHaveLength(1)
    write(controller, { value: 2 })
    expect(writes).toHaveLength(2)
  })

  it('drops a pending write that went back to what is stored', () => {
    const { controller, writes, timers } = setup()
    const loaded = { value: 1 }
    controller.markHydrated(loaded)

    write(controller, { value: 2 })
    write(controller, loaded)
    timers.advance(1000)

    expect(writes).toEqual([])
  })

  it('stamps the version it was told to', () => {
    const { controller, writes } = setup()
    controller.markHydrated(undefined)
    controller.setWriteVersion(3)
    write(controller, { value: 1 }, 5)
    controller.flush()
    expect(JSON.parse(itemAt(writes, 0)).version).toBe(3)
  })

  it('keeps a copy of an unreadable payload and starts fresh', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { controller, disk } = setup('{not json')
    expect(controller.storage.getItem('store')).toBeNull()
    expect(disk.get('store:unreadable')).toBe('{not json')
    warn.mockRestore()
  })

  it('preserves the stored payload once, without overwriting an earlier copy', () => {
    const stored = JSON.stringify({ state: { value: 1 }, version: 9 })
    const { controller, disk } = setup(stored)
    void controller.storage.getItem('store')

    controller.preserveStoredCopy('v9')
    disk.set('store', 'changed')
    void controller.storage.getItem('store')
    controller.preserveStoredCopy('v9')

    expect(disk.get('store:v9')).toBe(stored)
  })

  it('redacts a side copy before it is written, and redacts copies of older builds on request (K10)', () => {
    const redact = (raw: string) => raw.replace(/s3cret/g, '***')
    const { controller, disk } = setup(JSON.stringify({ state: { password: 's3cret' }, version: 1 }), redact)
    disk.set('store:unloaded', 'old s3cret copy')
    disk.set('other:key', 's3cret')
    void controller.storage.getItem('store')

    controller.preserveStoredCopy('v1-before-migration')
    expect(disk.get('store:v1-before-migration')).toBe('{"state":{"password":"***"},"version":1}')

    controller.redactStoredCopies()
    expect(disk.get('store:unloaded')).toBe('old *** copy')
    // Only this store's copies.
    expect(disk.get('other:key')).toBe('s3cret')
  })

  it('discards the side copies asked for and no others (K10)', () => {
    const { controller, disk } = setup()
    disk.set('store:v1-before-migration', 'a')
    disk.set('store:v2-before-migration', 'b')
    disk.set('store:unreadable', 'c')
    controller.discardStoredCopies((suffix) => suffix.endsWith('-before-migration'))
    expect([...disk.keys()].sort()).toEqual(['store:unreadable'])
  })
})
