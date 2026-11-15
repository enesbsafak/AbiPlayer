import { useStore } from '@/store'
import { secureCredentialService } from '@/services/secure-credentials'
import type { PlaylistSource } from '@/types/playlist'
import type { XtreamCredentials } from '@/types/xtream'

/*
 * Entering the secret of an existing source again (K3): the Xtream username
 * and password, or the M3U playlist URL, when the stored one is gone (the
 * credential file could not be read and was moved aside) or was refused.
 * The source keeps its id, so its favourites, history and hidden categories
 * stay attached; deleting and adding it again would give it a new id.
 */

export interface SecretFields {
  url: string
  username?: string
  password?: string
}

export type SourceSecret = XtreamCredentials | { m3uUrl: string }

export type SecretInputResult = { ok: true; secret: SourceSecret } | { ok: false; error: string }

/** The source can have its secret entered again here. */
export function canEnterSecretAgain(source: PlaylistSource): boolean {
  return source.type === 'xtream' || source.type === 'm3u_url'
}

function withScheme(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `http://${value}`
}

/** Checks and normalizes what the user typed, the way the add forms do. */
export function normalizeSecretInput(
  source: PlaylistSource,
  fields: SecretFields,
  others: readonly PlaylistSource[] = []
): SecretInputResult {
  const rawUrl = fields.url.trim()
  if (!rawUrl) return { ok: false, error: source.type === 'xtream' ? 'Sunucu adresi boş bırakılamaz' : 'Liste adresi boş bırakılamaz' }
  let parsed: URL
  try {
    parsed = new URL(withScheme(source.type === 'xtream' ? rawUrl.replace(/\/+$/, '') : rawUrl))
  } catch {
    return { ok: false, error: source.type === 'xtream' ? 'Geçersiz sunucu adresi' : 'Geçersiz URL adresi' }
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Yalnızca HTTP/HTTPS adresleri destekleniyor' }
  }

  if (source.type === 'xtream') {
    const username = (fields.username ?? '').trim()
    const password = (fields.password ?? '').trim()
    if (!username || !password) return { ok: false, error: 'Kullanıcı adı ve şifre boş bırakılamaz' }
    const url = parsed.toString().replace(/\/+$/, '')
    const duplicate = others.find(
      (other) => other.id !== source.id && other.type === 'xtream' && other.url === url && other.username === username
    )
    if (duplicate) return { ok: false, error: `Bu sunucu ve kullanıcı adı zaten "${duplicate.name}" olarak ekli` }
    return { ok: true, secret: { url, username, password } }
  }

  const m3uUrl = parsed.toString()
  const duplicate = others.find((other) => other.id !== source.id && other.type === 'm3u_url' && other.url === m3uUrl)
  if (duplicate) return { ok: false, error: `Bu URL zaten "${duplicate.name}" olarak ekli` }
  return { ok: true, secret: { m3uUrl } }
}

export interface SaveSecretDeps {
  setXtream?: (sourceId: string, credentials: XtreamCredentials) => Promise<void>
  setM3uUrl?: (sourceId: string, url: string) => Promise<void>
}

/**
 * Stores the secret in the secure store first (a failed write changes
 * nothing and rejects), then puts it on the source in place and connects
 * the source again. The source keeps its id.
 */
export async function saveSourceSecret(sourceId: string, secret: SourceSecret, deps: SaveSecretDeps = {}): Promise<void> {
  if ('m3uUrl' in secret) {
    await (deps.setM3uUrl ?? secureCredentialService.setM3uUrl)(sourceId, secret.m3uUrl)
  } else {
    await (deps.setXtream ?? secureCredentialService.set)(sourceId, secret)
  }
  const state = useStore.getState()
  if (!state.sources.some((source) => source.id === sourceId)) return
  state.updateSource(sourceId, 'm3uUrl' in secret ? { url: secret.m3uUrl } : { ...secret })
  // The secure store holds it now: no plain copy is kept for it.
  state.markSecretsMigrated([sourceId])
  state.setSourceError(sourceId, null)
  // Its stopped attempt starts over with the new secret.
  state.requestSourceReconnect()
}
