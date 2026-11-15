import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MpvStateSnapshot } from '../../../shared/types/electron-ipc'
import { subscribeMpvState } from './platform'

function installBridge(current: Partial<MpvStateSnapshot>) {
  const pushListeners = new Set<(snapshot: MpvStateSnapshot) => void>()
  const bridge = {
    mpvSubscribe: vi.fn(() => Promise.resolve(current as MpvStateSnapshot)),
    mpvUnsubscribe: vi.fn(() => Promise.resolve()),
    onMpvState: vi.fn((listener: (snapshot: MpvStateSnapshot) => void) => {
      pushListeners.add(listener)
      return () => pushListeners.delete(listener)
    })
  }
  vi.stubGlobal('electron', bridge)
  return {
    bridge,
    push: (snapshot: Partial<MpvStateSnapshot>) => {
      for (const listener of pushListeners) listener(snapshot as MpvStateSnapshot)
    },
    pushListeners
  }
}

describe('subscribeMpvState', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null outside Electron', () => {
    expect(subscribeMpvState(() => undefined)).toBeNull()
  })

  it('hands every listener the current snapshot, then the pushes, over one IPC subscription', async () => {
    const { bridge, push, pushListeners } = installBridge({ seq: 7 })
    const first: number[] = []
    const second: number[] = []

    const stopFirst = subscribeMpvState((snapshot) => first.push(snapshot.seq))!
    const stopSecond = subscribeMpvState((snapshot) => second.push(snapshot.seq))!
    await Promise.resolve()
    push({ seq: 8 })

    expect(first).toEqual([7, 8])
    expect(second).toEqual([7, 8])
    expect(bridge.onMpvState).toHaveBeenCalledTimes(1)

    stopFirst()
    expect(bridge.mpvUnsubscribe).not.toHaveBeenCalled()
    stopSecond()
    expect(bridge.mpvUnsubscribe).toHaveBeenCalledTimes(1)
    expect(pushListeners.size).toBe(0)
  })

  it('does not deliver the initial snapshot to a listener that already left', async () => {
    installBridge({ seq: 1 })
    const listener = vi.fn()
    subscribeMpvState(listener)!()
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
  })
})
