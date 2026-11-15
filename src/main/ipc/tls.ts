import type { TlsPolicy } from '../tls/policy'
import type { IpcRegistrar } from './register'

export type TlsPolicyApi = Pick<TlsPolicy, 'listTrusted' | 'listUntrusted' | 'trust' | 'revoke'>

/** Trust channels; the policy validates every argument itself. */
export function registerTlsHandlers(registrar: IpcRegistrar, policy: TlsPolicyApi): void {
  registrar.handle('tls-list-trusted', () => policy.listTrusted())
  registrar.handle('tls-list-untrusted', () => policy.listUntrusted())
  registrar.handle('tls-trust', (_event, request) => {
    if (!request || typeof request !== 'object') throw new Error('Geçersiz sertifika onayı')
    return policy.trust(request as Parameters<TlsPolicy['trust']>[0])
  })
  registrar.handle('tls-revoke', (_event, host, port) => policy.revoke(host, port))
}
