import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdateState } from '@/services/platform'

const platform = vi.hoisted(() => ({
  isElectron: vi.fn(() => true),
  getAppUpdateState: vi.fn(),
  checkForAppUpdates: vi.fn(),
  installAppUpdate: vi.fn(),
  onAppUpdateStateChange: vi.fn(() => () => {})
}))

vi.mock('@/services/platform', () => platform)

const store = vi.hoisted(() => ({ flushPersistedStore: vi.fn() }))
vi.mock('@/store', () => store)

import { useAppUpdate } from './useAppUpdate'
import { describeCheckOutcome } from '@/components/layout/UpdateBadge'
import { strings } from '@/strings'

function updateState(overrides: Partial<AppUpdateState> = {}): AppUpdateState {
  return {
    status: 'idle',
    currentVersion: '1.0.0',
    availableVersion: null,
    downloadedVersion: null,
    progress: null,
    transferredBytes: null,
    totalBytes: null,
    bytesPerSecond: null,
    message: null,
    releaseDate: null,
    canCheck: true,
    updateReadyToInstall: false,
    installBlocked: false,
    lastCheckedAt: null,
    ...overrides
  }
}

describe('useAppUpdate', () => {
  beforeEach(() => {
    platform.isElectron.mockReturnValue(true)
    platform.getAppUpdateState.mockResolvedValue(updateState())
    platform.onAppUpdateStateChange.mockReturnValue(() => {})
  })

  it('does not stay in the checking state when the check rejects', async () => {
    platform.checkForAppUpdates.mockRejectedValue(
      new Error("Error invoking remote method 'app-update-check': Error: net::ERR_INTERNET_DISCONNECTED")
    )
    const { result } = renderHook(() => useAppUpdate())

    let returned: AppUpdateState | null | undefined
    await act(async () => {
      returned = await result.current.check()
    })

    expect(returned).toBeNull()
    expect(result.current.isChecking).toBe(false)
    expect(result.current.checkError).toBe(
      'Sunucuya ulaşılamadı. İnternet bağlantını ve sunucu adresini kontrol et.'
    )
  })

  it('keeps checking until the broadcast when the check is still running', async () => {
    platform.checkForAppUpdates.mockResolvedValue(updateState({ status: 'checking' }))
    const { result } = renderHook(() => useAppUpdate())

    await act(async () => {
      await result.current.check()
    })

    expect(result.current.isChecking).toBe(true)
    expect(result.current.checkError).toBeNull()
  })

  it('writes the pending store state before the install closes the app', async () => {
    const order: string[] = []
    store.flushPersistedStore.mockImplementation(() => order.push('flush'))
    platform.installAppUpdate.mockImplementation(async () => {
      order.push('install')
      return true
    })
    const { result } = renderHook(() => useAppUpdate())

    await act(async () => {
      await result.current.install()
    })

    expect(order).toEqual(['flush', 'install'])
  })

  it('clears the installing flag when install rejects', async () => {
    platform.installAppUpdate.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useAppUpdate())

    await act(async () => {
      await result.current.install()
    })

    expect(result.current.isInstalling).toBe(false)
  })
})

describe('describeCheckOutcome', () => {
  it('reports up to date, an update, or the error', () => {
    expect(describeCheckOutcome(updateState({ status: 'not-available' }), null)?.text).toBe('Güncel')
    expect(describeCheckOutcome(updateState({ status: 'available' }), null)?.text).toBe(
      'Güncelleme var'
    )
    expect(
      describeCheckOutcome(updateState({ status: 'error', message: 'Sunucu yanıt vermedi' }), null)
        ?.text
    ).toBe('Sunucu yanıt vermedi')
    expect(describeCheckOutcome(null, strings.settings.updates.checkFailed)?.tone).toBe('error')
    expect(describeCheckOutcome(updateState({ status: 'idle' }), null)).toBeNull()
  })
})
