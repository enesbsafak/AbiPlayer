// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { EVENT_METHODS, INVOKE_METHODS } from '../shared/ipc/api'
import { buildElectronApi } from './build-api'

describe('buildElectronApi', () => {
  it('exposes one method per table entry, invoking its channel with the call arguments', async () => {
    const invoke = vi.fn().mockResolvedValue('ok')
    const api = buildElectronApi({ invoke, subscribe: vi.fn() })

    expect(Object.keys(api).sort()).toEqual(
      [...Object.keys(INVOKE_METHODS), ...Object.keys(EVENT_METHODS)].sort()
    )

    await expect(api.extractEmbeddedSubtitle('http://x/a.mkv', 2, { jobId: 'j1' })).resolves.toBe('ok')
    expect(invoke).toHaveBeenCalledWith('embedded-subtitles-extract', ['http://x/a.mkv', 2, { jobId: 'j1' }])

    await api.windowMinimize()
    expect(invoke).toHaveBeenLastCalledWith('window-minimize', [])
  })

  it('wires subscriptions to their event channel and returns the unsubscribe function', () => {
    const unsubscribe = vi.fn()
    const subscribe = vi.fn().mockReturnValue(unsubscribe)
    const api = buildElectronApi({ invoke: vi.fn(), subscribe })
    const listener = vi.fn()

    expect(api.onWindowStateChange(listener)).toBe(unsubscribe)
    expect(subscribe).toHaveBeenCalledWith('window-state-changed', listener)
  })

  // Nothing called it; window state now comes from windowGetState + onWindowStateChange.
  it('no longer exposes windowIsMaximized', () => {
    const api = buildElectronApi({ invoke: vi.fn(), subscribe: vi.fn() })
    expect('windowIsMaximized' in api).toBe(false)
  })
})
