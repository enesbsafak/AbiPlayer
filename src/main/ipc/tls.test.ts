// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { IpcInvokeChannel } from '../../shared/ipc/contract'
import type { IpcHandler } from './register'
import { registerTlsHandlers, type TlsPolicyApi } from './tls'

type AnyHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function setup() {
  const handlers = new Map<string, AnyHandler>()
  const policy = {
    listTrusted: vi.fn(() => []),
    listUntrusted: vi.fn(() => []),
    trust: vi.fn(async () => ({})),
    revoke: vi.fn(async () => true)
  }
  registerTlsHandlers(
    {
      handle<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>) {
        handlers.set(channel, handler as unknown as AnyHandler)
      }
    },
    policy as unknown as TlsPolicyApi
  )
  const event = {} as IpcMainInvokeEvent
  const call = async (channel: IpcInvokeChannel, ...args: unknown[]) => handlers.get(channel)!(event, ...args)
  return { policy, call, handlers }
}

describe('TLS trust channels', () => {
  it('registers the four channels', () => {
    expect([...setup().handlers.keys()].sort()).toEqual([
      'tls-list-trusted',
      'tls-list-untrusted',
      'tls-revoke',
      'tls-trust'
    ])
  })

  it('passes requests to the policy and rejects a malformed trust request', async () => {
    const { policy, call } = setup()
    await call('tls-trust', { host: 'panel.example', port: 443, fingerprint256: 'AA' })
    expect(policy.trust).toHaveBeenCalledWith({ host: 'panel.example', port: 443, fingerprint256: 'AA' })
    await expect(call('tls-trust', 'panel.example')).rejects.toThrow('Geçersiz')
    await call('tls-revoke', 'panel.example', 443)
    expect(policy.revoke).toHaveBeenCalledWith('panel.example', 443)
  })
})
