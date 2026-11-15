import { EVENT_METHODS, INVOKE_METHODS, type ElectronApi } from '../shared/ipc/api'
import type { IpcEventChannel, IpcInvokeChannel } from '../shared/ipc/contract'

export interface IpcTransport {
  invoke(channel: IpcInvokeChannel, args: unknown[]): Promise<unknown>
  subscribe(channel: IpcEventChannel, listener: (payload: unknown) => void): () => void
}

/**
 * Builds the object exposed as `window.electron` from the shared method
 * tables. Kept free of `electron` imports so it can be tested in plain Node.
 */
export function buildElectronApi(transport: IpcTransport): ElectronApi {
  const api: Record<string, unknown> = {}

  for (const [method, channel] of Object.entries(INVOKE_METHODS)) {
    api[method] = (...args: unknown[]) => transport.invoke(channel, args)
  }

  for (const [method, channel] of Object.entries(EVENT_METHODS)) {
    api[method] = (listener: (payload: unknown) => void) => transport.subscribe(channel, listener)
  }

  // The loops above produce exactly the keys and call shapes `ElectronApi`
  // is computed from; TypeScript cannot follow `Object.entries`, so the
  // object is typed once here.
  return api as ElectronApi
}
