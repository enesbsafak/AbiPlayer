import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_JOB_CANCELLED_MESSAGE } from '../../../shared/ipc/contract'
import {
  cancelAllMediaJobs,
  cancelMediaJob,
  checkForAppUpdates,
  getAppUpdateState,
  installAppUpdate,
  isElectron,
  isMediaJobCancelledError,
  onAppUpdateStateChange,
  onWindowStateChange,
  readPickedFile,
  windowGetState
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

  it('wraps the new file, media-job and window-state calls', async () => {
    const electron = {
      readPickedFile: vi.fn().mockResolvedValue({ path: 'C:\\a.m3u', content: '#EXTM3U' }),
      cancelMediaJob: vi.fn().mockResolvedValue(true),
      onWindowStateChange: vi.fn().mockReturnValue(() => undefined),
      windowGetState: vi.fn().mockResolvedValue({ isMaximized: true, isFullScreen: false })
    }
    vi.stubGlobal('window', { electron })

    await expect(readPickedFile('C:\\a.m3u')).resolves.toEqual({ path: 'C:\\a.m3u', content: '#EXTM3U' })
    await expect(cancelMediaJob('job-1')).resolves.toBe(true)
    expect(electron.cancelMediaJob).toHaveBeenLastCalledWith('job-1')
    await cancelAllMediaJobs()
    expect(electron.cancelMediaJob).toHaveBeenLastCalledWith()
    await expect(windowGetState()).resolves.toEqual({ isMaximized: true, isFullScreen: false })
    const listener = vi.fn()
    onWindowStateChange(listener)
    expect(electron.onWindowStateChange).toHaveBeenCalledWith(listener)
  })

  it('recognises a cancelled media job through the IPC error prefix', () => {
    expect(
      isMediaJobCancelledError(
        new Error(`Error invoking remote method 'embedded-subtitles-probe': Error: ${MEDIA_JOB_CANCELLED_MESSAGE}`)
      )
    ).toBe(true)
    expect(isMediaJobCancelledError(new Error('İşlem zaman aşımına uğradı'))).toBe(false)
  })
})
