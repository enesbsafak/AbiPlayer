import { credentialsInUrl, maskCredentials } from '../../../shared/mask-credentials'

/*
 * Side copies of the persisted payload (kept when a migration fails, or when
 * it cannot be read) are for recovering favourites, history and settings.
 * They must not keep what the app otherwise keeps out of localStorage: Xtream
 * passwords and account names, M3U playlist URLs (they usually carry the
 * account), entry URLs and the TMDB key.
 */

const MASK = '***'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Secret values found in the payload, for masking wherever else they appear. */
function collectSecrets(state: Record<string, unknown>): string[] {
  const secrets = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.length >= 3) secrets.add(value)
  }
  if (Array.isArray(state.sources)) {
    for (const source of state.sources) {
      if (!isRecord(source)) continue
      add(source.username)
      add(source.password)
      if (source.type === 'm3u_url' && typeof source.url === 'string') {
        add(source.url)
        for (const part of credentialsInUrl(source.url)) add(part)
      }
    }
  }
  if (isRecord(state.settings)) add(state.settings.tmdbApiKey)
  return [...secrets]
}

function redactSources(sources: unknown): unknown {
  if (!Array.isArray(sources)) return sources
  return sources.map((source) => {
    if (!isRecord(source)) return source
    const { username: _username, password: _password, ...rest } = source
    if (rest.type === 'm3u_url') delete rest.url
    return rest
  })
}

/** Every string through `maskCredentials`, every `streamUrl` emptied. */
function scrub(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    let masked = maskCredentials(value, secrets)
    // A whole value that is a secret (a URL used as a key, say).
    for (const secret of secrets) if (masked === secret) masked = MASK
    return masked
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, secrets))
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = key === 'streamUrl' && typeof item === 'string' ? '' : scrub(item, secrets)
  }
  return result
}

/**
 * The payload with its secrets removed: source credentials and playlist URLs
 * dropped, the TMDB key dropped, entry URLs emptied, and anything else that
 * looks like (or contains) one of those masked. Text that is not JSON is
 * masked as text. Idempotent.
 */
export function redactStoredCopy(raw: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return maskCredentials(raw)
  }
  if (!isRecord(parsed)) return raw
  const state = isRecord(parsed.state) ? parsed.state : null
  if (!state) return JSON.stringify(scrub(parsed, []))

  const secrets = collectSecrets(state)
  const next: Record<string, unknown> = { ...state, sources: redactSources(state.sources) }
  if (!('sources' in state)) delete next.sources
  if (isRecord(state.settings)) {
    const { tmdbApiKey: _tmdbApiKey, ...settings } = state.settings
    next.settings = settings
  }
  return JSON.stringify({ ...parsed, state: scrub(next, secrets) })
}
