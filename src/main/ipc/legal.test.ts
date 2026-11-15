// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { mainStrings } from '../../shared/main-strings'
import { registerLegalHandlers, type LegalHandlerDeps } from './legal'
import type { IpcRegistrar } from './register'

function setup(deps: Partial<LegalHandlerDeps> = {}) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const registrar: IpcRegistrar = {
    handle(channel, handler) {
      handlers.set(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)
    }
  }
  const resolve = vi.fn(deps.resolve ?? ((target: string) => `C:\\App\\resources\\legal\\${target}`))
  const openPath = vi.fn(deps.openPath ?? (async () => ''))
  registerLegalHandlers(registrar, { resolve, openPath })
  const invoke = (...args: unknown[]) => handlers.get('legal-open-notice')?.({} as IpcMainInvokeEvent, ...args)
  return { invoke, resolve, openPath }
}

describe('legal-open-notice', () => {
  it('opens the resolved path and reports success', async () => {
    const { invoke, openPath } = setup()
    await expect(invoke('notices')).resolves.toBe(true)
    expect(openPath).toHaveBeenCalledWith('C:\\App\\resources\\legal\\notices')
  })

  it('reports false when the file is missing or Windows could not open it', async () => {
    const missing = setup({ resolve: () => null })
    await expect(missing.invoke('licenses')).resolves.toBe(false)
    expect(missing.openPath).not.toHaveBeenCalled()

    const failed = setup({ openPath: async () => 'No application is associated' })
    await expect(failed.invoke('notices')).resolves.toBe(false)
  })

  it('refuses anything but the two fixed targets and never opens a renderer path', async () => {
    const { invoke, resolve, openPath } = setup()
    await expect(invoke('C:\\Windows\\System32\\cmd.exe')).rejects.toThrow(mainStrings.invalid.legalNotice)
    await expect(invoke()).rejects.toThrow(mainStrings.invalid.legalNotice)
    expect(resolve).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
  })
})
