import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkForAppUpdates,
  getAppUpdateState,
  installAppUpdate,
  isElectron,
  onAppUpdateStateChange
} from './platform'

describe('platform electron wrappers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns safe defaults outside Electron', async () => {
    vi.stubGlobal('window', {})

    expect(isElectron()).toBe(false)
    await expect(getAppUpdateState()).resolves.toBeNull()
    await expect(checkForAppUpdates()).resolves.toBeNull()
    await expect(installAppUpdate()).resolves.toBe(false)
    expect(onAppUpdateStateChange(() => undefined)).toBeNull()
  })

  it('delegates update calls to the preload bridge inside Electron', async () => {
    const remove = vi.fn()
    const getAppUpdateStateMock = vi.fn().mockResolvedValue({ status: 'idle', canCheck: true })
    const checkForAppUpdatesMock = vi.fn().mockResolvedValue({ status: 'checking', canCheck: true })
    const installAppUpdateMock = vi.fn().mockResolvedValue(true)
    const onAppUpdateStateChangeMock = vi.fn().mockReturnValue(remove)

    vi.stubGlobal('window', {
      electron: {
        getAppUpdateState: getAppUpdateStateMock,
        checkForAppUpdates: checkForAppUpdatesMock,
        installAppUpdate: installAppUpdateMock,
        onAppUpdateStateChange: onAppUpdateStateChangeMock
      }
    })

    expect(isElectron()).toBe(true)
    await expect(getAppUpdateState()).resolves.toEqual({ status: 'idle', canCheck: true })
    await expect(checkForAppUpdates()).resolves.toEqual({ status: 'checking', canCheck: true })
    await expect(installAppUpdate()).resolves.toBe(true)

    const listener = vi.fn()
    expect(onAppUpdateStateChange(listener)).toBe(remove)
    expect(getAppUpdateStateMock).toHaveBeenCalledTimes(1)
    expect(checkForAppUpdatesMock).toHaveBeenCalledTimes(1)
    expect(installAppUpdateMock).toHaveBeenCalledTimes(1)
    expect(onAppUpdateStateChangeMock).toHaveBeenCalledWith(listener)
  })
})
