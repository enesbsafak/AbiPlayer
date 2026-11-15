import { useStore } from '@/store'
import { secureCredentialService } from '@/services/secure-credentials'
import { isValidTmdbApiKey } from '../../../../shared/secure-credentials'

/**
 * Saves the TMDB key the user typed: in the secure credential store, never
 * in localStorage. Only once that write worked does the app use the new key
 * (and stop keeping an older plain copy). An empty key removes it.
 */
export async function saveTmdbApiKey(
  raw: string,
  store: (apiKey: string) => Promise<void> = secureCredentialService.setTmdbApiKey
): Promise<string> {
  const apiKey = raw.trim()
  if (apiKey && !isValidTmdbApiKey(apiKey)) {
    throw new Error('Geçersiz TMDB anahtarı: boşluk ya da özel karakter içermemeli.')
  }
  await store(apiKey)
  const state = useStore.getState()
  state.updateSettings({ tmdbApiKey: apiKey })
  state.setTmdbKeyPlainPending(false)
  return apiKey
}
