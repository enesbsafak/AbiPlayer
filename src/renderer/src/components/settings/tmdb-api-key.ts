import { useStore } from '@/store'
import { isTmdbCatalogSource } from '@/addons/builtin'
import { secureCredentialService } from '@/services/secure-credentials'
import { isValidTmdbApiKey } from '../../../../shared/secure-credentials'
import { strings } from '@/strings'

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
    throw new Error(strings.settings.general.tmdbKeyInvalid)
  }
  await store(apiKey)
  const state = useStore.getState()
  state.updateSettings({ tmdbApiKey: apiKey })
  state.setTmdbKeyPlainPending(false)
  // The TMDB catalogue stopped for want of a key (or a refused one) connects again with this one.
  const catalogue = state.sources.find((source) => isTmdbCatalogSource(source))
  if (apiKey && catalogue && (state.sourceErrors[catalogue.id] || !state.addonSessions[catalogue.id])) {
    state.requestSourceReconnect()
  }
  return apiKey
}
