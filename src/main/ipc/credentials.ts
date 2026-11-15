import type { IpcRegistrar } from './register'
import { copySourceSecret } from '../../shared/secure-credentials'
import { isValidSourceId, isValidSourceSecret, isValidTmdbApiKey, type CredentialStore } from './credential-store'

export function registerCredentialHandlers(registrar: IpcRegistrar, store: CredentialStore): void {
  registrar.handle('secure-credentials-get-all', () => store.getAll())

  registrar.handle('secure-credentials-set', async (_event, sourceId, credential) => {
    if (!isValidSourceId(sourceId)) throw new Error('Geçersiz kaynak kimliği')
    if (!isValidSourceSecret(credential)) throw new Error('Geçersiz kimlik bilgisi verisi')
    await store.set(sourceId, copySourceSecret(credential))
  })

  registrar.handle('secure-credentials-delete', async (_event, sourceId) => {
    if (!isValidSourceId(sourceId)) throw new Error('Geçersiz kaynak kimliği')
    await store.delete(sourceId)
  })

  registrar.handle('secure-credentials-get-loss', () => store.getLossNotice())

  registrar.handle('secure-credentials-get-cache-key', () => store.getCacheKey())

  registrar.handle('secure-credentials-get-tmdb-key', () => store.getTmdbApiKey())

  registrar.handle('secure-credentials-set-tmdb-key', async (_event, apiKey) => {
    if (apiKey !== null && !isValidTmdbApiKey(apiKey)) throw new Error('Geçersiz TMDB anahtarı')
    await store.setTmdbApiKey(apiKey)
  })
}
