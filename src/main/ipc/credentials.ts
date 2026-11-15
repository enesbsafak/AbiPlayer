import type { IpcRegistrar } from './register'
import { isValidCredential, isValidSourceId, type CredentialStore } from './credential-store'

export function registerCredentialHandlers(registrar: IpcRegistrar, store: CredentialStore): void {
  registrar.handle('secure-credentials-get-all', () => store.getAll())

  registrar.handle('secure-credentials-set', async (_event, sourceId, credential) => {
    if (!isValidSourceId(sourceId)) throw new Error('Geçersiz kaynak kimliği')
    if (!isValidCredential(credential)) throw new Error('Geçersiz kimlik bilgisi verisi')
    await store.set(sourceId, {
      url: credential.url,
      username: credential.username,
      password: credential.password
    })
  })

  registrar.handle('secure-credentials-delete', async (_event, sourceId) => {
    if (!isValidSourceId(sourceId)) throw new Error('Geçersiz kaynak kimliği')
    await store.delete(sourceId)
  })

  registrar.handle('secure-credentials-get-loss', () => store.getLossNotice())
}
