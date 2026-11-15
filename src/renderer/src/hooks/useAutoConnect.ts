import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import { XtreamRequestError } from '@/services/xtream-errors'
import { readPickedFile } from '@/services/platform'
import { secureCredentialService, type SourceSecrets } from '@/services/secure-credentials'
import { classifyError, toUserMessage } from '@/services/user-error'
import { catalog } from '@/catalog/catalog-store'
import { certificateAwareError } from '@/catalog/certificate-errors'
import { isCatalogCacheSettled, refreshCatalogCacheKey, watchCatalogCache } from '@/catalog/cache-lifecycle'
import { ingestDropped, ingestM3uText, ingestM3uUrl, type IngestOutcome } from '@/catalog/worker-ingest'
import { CATALOG_TYPES } from '@/catalog/types'
import type { CatalogStatusMap } from '@/store/playlist-slice'
import { plainSecretOf, type SourceConnectionError } from '@/store/auth-slice'
import type { PlaylistSource } from '@/types/playlist'
import type { XtreamAuthResponse } from '@/types/xtream'
import { perfMark } from '@/services/perf'

/** Waits before automatic attempt n (1-based) after a failed connection; the last one repeats. */
export const RECONNECT_DELAYS_MS = [3_000, 6_000, 12_000, 24_000, 48_000, 60_000] as const

export function reconnectDelayMs(failures: number): number {
  const index = Math.min(Math.max(failures, 1), RECONNECT_DELAYS_MS.length) - 1
  return RECONNECT_DELAYS_MS[index]
}

/**
 * Ids of sources with catalog data from this session, as one string so the
 * selector result is stable. A list shown from the disk cache does not count:
 * the source still connects (its playlist is fetched again at start).
 */
export function sourcesWithCatalogKey(status: CatalogStatusMap): string {
  const ids: string[] = []
  for (const [sourceId, types] of Object.entries(status)) {
    if (types && Object.values(types).some((entry) => entry?.loaded && !entry.fromCache)) ids.push(sourceId)
  }
  return ids.sort().join('\n')
}

/** When the cached copy a source shows was fetched, if a cached copy is what it shows. */
export function cachedCopyFetchedAt(sourceId: string): number | null {
  const times = CATALOG_TYPES.map((type) => catalog.getStatus(sourceId, type)).flatMap((status) =>
    status?.fromCache && status.fetchedAt ? [status.fetchedAt] : []
  )
  return times.length > 0 ? Math.min(...times) : null
}

export function formatCacheTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Waits (briefly) until the source's cached catalog, if it has one, is in memory. */
async function cacheSettled(sourceId: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!isCatalogCacheSettled(sourceId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function authedSourcesKey(auth: Record<string, XtreamAuthResponse>): string {
  return Object.keys(auth).sort().join('\n')
}

/** A connection attempt that will fail again the same way until the user acts. */
export class SourceConnectError extends Error {
  constructor(
    readonly kind: Exclude<SourceConnectionError['kind'], 'other'>,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'SourceConnectError'
  }
}

/** The source still has to be connected: signed in, or its playlist loaded. */
export function needsConnection(source: PlaylistSource, authed: ReadonlySet<string>, withCatalog: ReadonlySet<string>): boolean {
  if (source.type === 'xtream') return !authed.has(source.id)
  return !withCatalog.has(source.id)
}

/**
 * What a failure means for the source: the user message to show on it and
 * whether trying again on a timer can help. A refused account or a missing
 * file will not fix itself, so those stop the automatic attempts.
 */
export function describeConnectFailure(
  error: unknown,
  failures: number,
  now: number
): SourceConnectionError {
  if (error instanceof SourceConnectError) {
    return { kind: error.kind, message: error.message, retryAt: null }
  }
  if (classifyError(error) === 'auth') {
    return { kind: 'auth', message: toUserMessage(error), retryAt: null }
  }
  return {
    kind: 'other',
    message: toUserMessage(error, 'Kaynağa bağlanılamadı.'),
    retryAt: now + reconnectDelayMs(failures)
  }
}

/** The one-line summary the dashboard shows while sources are not connected. */
export function connectionSummary(
  sources: readonly PlaylistSource[],
  errors: Readonly<Record<string, SourceConnectionError>>
): string | null {
  const failures = sources.filter((source) => errors[source.id]).map((source) => `${source.name}: ${errors[source.id].message}`)
  if (failures.length === 0) return null
  if (failures.length === 1) return failures[0]
  return `${failures.length} kaynağa bağlanılamadı — ${failures.join(' · ')}`
}

export interface ConnectDeps {
  setXtreamAuth: (sourceId: string, auth: XtreamAuthResponse) => void
  /** The secure store could not be read (it is read again): a missing secret is not gone. */
  secretsUnavailable?: boolean
  authenticate?: typeof xtreamApi.authenticate
  readFile?: typeof readPickedFile
  /** The catalog worker's playlist ingest (tests replace it). */
  ingestUrl?: typeof ingestM3uUrl
  ingestText?: typeof ingestM3uText
  /** The source is still configured (default: it is in the store). */
  sourceExists?: (sourceId: string) => boolean
}

export const SECRETS_UNAVAILABLE_MESSAGE = 'Kayıtlı giriş bilgileri şu an okunamıyor; uygulama yeniden deneyecek.'
export const MISSING_XTREAM_SECRET_MESSAGE =
  'Kayıtlı kullanıcı adı ve şifre bulunamadı. Ayarlar > Kaynaklar bölümünden bu kaynağın bilgilerini yeniden girin.'
export const MISSING_M3U_URL_MESSAGE =
  'Kayıtlı liste adresi bulunamadı. Ayarlar > Kaynaklar bölümünden bu kaynağın adresini yeniden girin.'

function missingSecret(message: string, deps: ConnectDeps): SourceConnectError {
  return new SourceConnectError('missing-secret', deps.secretsUnavailable ? SECRETS_UNAVAILABLE_MESSAGE : message)
}

/**
 * Main reads again only files the user picked in its dialog, and the list of
 * those starts empty after an update from a version that did not keep one.
 */
function isNotPickedError(message: string): boolean {
  return message.includes('okuma izni yok')
}

/** Why a playlist file could not be read again, in one sentence, and what to do. */
export function fileReadFailureMessage(error: unknown, cachedAt: number | null): string {
  const kept = cachedAt ? ` Dosyanın ${formatCacheTime(cachedAt)} tarihinde okunan kopyası gösteriliyor.` : ''
  const reason = toUserMessage(error, 'Liste dosyası okunamadı.')
  if (isNotPickedError(reason)) {
    const meanwhile = cachedAt ? `; o zamana kadar dosyanın ${formatCacheTime(cachedAt)} tarihinde okunan kopyası gösteriliyor.` : '.'
    return `Uygulama yalnızca sizin seçtiğiniz dosyaları okuyabildiği için bu liste dosyasını Ayarlar > Kaynaklar bölümünde "Dosyayı Yeniden Seç" ile bir kez yeniden seçin${meanwhile}`
  }
  const ask = /yeniden seçin\.?$/i.test(reason) ? '' : ' Dosyayı yeniden seçin.'
  return `${reason}${ask}${kept}`
}

/** A dropped playlist is fetched again this many times before the attempt fails (and is retried on a timer). */
const DROPPED_INGEST_ATTEMPTS = 3

/**
 * Runs a playlist ingest until what it fetched is kept. The catalog drops it
 * when the source was refreshed or removed meanwhile; a removed source needs
 * nothing, and one whose fresh lists another load already put in place
 * neither. Otherwise the source would stay empty while the attempt counted as
 * a success, so the playlist is fetched again, and the attempt fails if that
 * keeps happening.
 */
async function ingestUntilKept(source: PlaylistSource, deps: ConnectDeps, run: () => Promise<IngestOutcome>): Promise<void> {
  const exists = deps.sourceExists ?? ((sourceId: string) => useStore.getState().sources.some((item) => item.id === sourceId))
  for (let attempt = 1; ; attempt += 1) {
    const outcome = await run()
    if (!ingestDropped(outcome) || !exists(source.id)) return
    const fresh = CATALOG_TYPES.every((type) => {
      const status = catalog.getStatus(source.id, type)
      return !!status?.complete && !status.fromCache
    })
    if (fresh) return
    if (attempt >= DROPPED_INGEST_ATTEMPTS) {
      throw new XtreamRequestError('network', 'Liste yüklenirken kaynak yeniden yüklendi. Yeniden denenecek.')
    }
  }
}

/**
 * One connection attempt for a saved source: sign in to an Xtream panel,
 * download an M3U playlist, or read a local playlist file again. Playlists
 * are parsed in the catalog worker and replace the cached copy shown in the
 * meantime once complete. Main only re-reads paths the user once picked in
 * its dialog; when the file is gone, the cached copy stays and the error
 * says so.
 */
export async function connectSource(source: PlaylistSource, deps: ConnectDeps): Promise<void> {
  if (source.type === 'xtream') {
    const secret = plainSecretOf(source)
    if (!secret || !('username' in secret)) throw missingSecret(MISSING_XTREAM_SECRET_MESSAGE, deps)
    perfMark('connect:auth-start')
    let auth: XtreamAuthResponse
    try {
      auth = await (deps.authenticate ?? xtreamApi.authenticate)(secret)
    } catch (error) {
      throw await certificateAwareError(error)
    }
    perfMark('connect:auth-done')
    if (auth.user_info.auth !== 1) {
      throw new XtreamRequestError('auth', 'Kimlik doğrulama başarısız (kullanıcı adı veya şifre reddedildi)')
    }
    deps.setXtreamAuth(source.id, auth)
    return
  }

  // The swap is dropped by the catalog when the source is removed or
  // refreshed meanwhile: the worker job's tokens are taken before it starts.
  if (source.type === 'm3u_url') {
    const url = source.url
    if (!url) throw missingSecret(MISSING_M3U_URL_MESSAGE, deps)
    try {
      await ingestUntilKept(source, deps, () => (deps.ingestUrl ?? ingestM3uUrl)(source.id, url))
    } catch (error) {
      throw await certificateAwareError(error)
    }
    return
  }

  const filePath = source.filePath
  if (!filePath) {
    throw new SourceConnectError('file', 'Liste dosyasının yolu kayıtlı değil. Dosyayı yeniden seçin.')
  }
  const readOnce = async () => {
    try {
      return await (deps.readFile ?? readPickedFile)(filePath)
    } catch (error) {
      // The cached copy may be all there is now: it stays, and the user is told.
      await cacheSettled(source.id)
      throw new SourceConnectError('file', fileReadFailureMessage(error, cachedCopyFetchedAt(source.id)), { cause: error })
    }
  }
  const empty: IngestOutcome = { results: {}, counts: {}, meta: null, epgUrls: [], job: { kind: 'ok' } }
  await ingestUntilKept(source, deps, async () => {
    const file = await readOnce()
    // Outside Electron there is nothing to read; the source stays empty.
    if (!file) return empty
    return (deps.ingestText ?? ingestM3uText)(source.id, file.content, file.path)
  })
}

export interface SecretMigrationPlan {
  /** Plain secrets to copy into the secure store. */
  writes: Array<{ sourceId: string; secret: NonNullable<ReturnType<typeof plainSecretOf>> }>
  /** Legacy sources the secure store already covers: their plain copy can go. */
  alreadyStored: string[]
}

/**
 * Which plain secrets of an older version still have to reach the secure
 * store. A source the store already knows keeps the stored value.
 */
export function planSecretMigration(
  sources: readonly PlaylistSource[],
  legacyIds: readonly string[],
  stored: SourceSecrets
): SecretMigrationPlan {
  const legacy = new Set(legacyIds)
  const plan: SecretMigrationPlan = { writes: [], alreadyStored: [] }
  for (const source of sources) {
    if (!legacy.has(source.id)) continue
    const secret = plainSecretOf(source)
    if (!secret) continue
    const known = source.type === 'xtream' ? stored.xtream[source.id] : stored.m3uUrls[source.id]
    if (known) plan.alreadyStored.push(source.id)
    else plan.writes.push({ sourceId: source.id, secret })
  }
  return plan
}

export const SECRET_MIGRATION_FAILED_MESSAGE =
  'Kayıtlı giriş bilgileri güvenli depoya taşınamadı. Bilgiler kaybolmasın diye şimdilik eski yerinde duruyor; uygulama her açılışta yeniden deneyecek.'

export const SECRET_STORE_UNREADABLE_MESSAGE =
  'Kayıtlı giriş bilgileri şu an okunamıyor. Bilgiler silinmedi; uygulama okumayı kendiliğinden yeniden deneyecek.'

/**
 * Moves a TMDB key an older version kept in the plain settings to the secure
 * store, keeping the plain copy until that write succeeded; otherwise puts
 * the stored key in the settings. True when the move failed.
 */
async function hydrateTmdbApiKey(stored: string | null): Promise<boolean> {
  const state = useStore.getState()
  if (!state.tmdbKeyPlainPending) {
    if ((stored ?? '') !== state.settings.tmdbApiKey) state.updateSettings({ tmdbApiKey: stored ?? '' })
    return false
  }
  // The store already has one (written by this version): it wins, like a source's stored secret.
  if (stored) {
    state.updateSettings({ tmdbApiKey: stored })
    state.setTmdbKeyPlainPending(false)
    return false
  }
  try {
    if (state.settings.tmdbApiKey) await secureCredentialService.setTmdbApiKey(state.settings.tmdbApiKey)
    useStore.getState().setTmdbKeyPlainPending(false)
    return false
  } catch (error) {
    console.warn('[credentials] moving the TMDB key to the secure store failed:', toUserMessage(error))
    return true
  }
}

/**
 * Reads the secure store and puts the secrets on the sources. Secrets an older
 * version kept in plain text are copied there first; the plain copy is only
 * dropped (`markSecretsMigrated`) for the writes that succeeded, so a failed
 * write keeps it for the next start and the user is told.
 *
 * A store that cannot be read at all is not treated as empty: the sources
 * wait (`secretStoreError`), the read is retried (useAutoConnect), and once
 * it works the cache key is fetched again and every source reconnects.
 * Returns whether the store could be read.
 */
export async function hydrateSecrets(): Promise<boolean> {
  const store = useStore.getState()
  const recovering = store.secretStoreError !== null
  let stored: SourceSecrets
  let storedTmdbKey: string | null
  try {
    perfMark('connect:credentials-ipc-start')
    ;[stored, storedTmdbKey] = await Promise.all([
      secureCredentialService.getAllSecrets(),
      secureCredentialService.getTmdbApiKey()
    ])
    perfMark('connect:credentials-ipc-done')
  } catch (error) {
    console.warn('[credentials] reading the secure store failed:', toUserMessage(error))
    if (store.legacySecretSourceIds.length > 0 || store.tmdbKeyPlainPending) {
      store.setSecretMigrationError(SECRET_MIGRATION_FAILED_MESSAGE)
    }
    store.setSecretStoreError(SECRET_STORE_UNREADABLE_MESSAGE)
    store.setCredentialsHydrated(true)
    return false
  }
  // The key could not be fetched while the store was unreadable: the cache
  // jobs these secrets start wait for it.
  if (recovering) void refreshCatalogCacheKey()

  const plan = planSecretMigration(useStore.getState().sources, useStore.getState().legacySecretSourceIds, stored)
  const secrets: SourceSecrets = { xtream: { ...stored.xtream }, m3uUrls: { ...stored.m3uUrls } }
  const migrated = [...plan.alreadyStored]
  let failed = 0
  await Promise.all(
    plan.writes.map(async ({ sourceId, secret }) => {
      try {
        if ('m3uUrl' in secret) {
          await secureCredentialService.setM3uUrl(sourceId, secret.m3uUrl)
          secrets.m3uUrls[sourceId] = secret.m3uUrl
        } else {
          await secureCredentialService.set(sourceId, secret)
          secrets.xtream[sourceId] = secret
        }
        migrated.push(sourceId)
      } catch (error) {
        failed += 1
        console.warn('[credentials] moving a stored secret to the secure store failed:', toUserMessage(error))
      }
    })
  )

  const tmdbFailed = await hydrateTmdbApiKey(storedTmdbKey)

  const latest = useStore.getState()
  latest.hydrateSourceSecrets(secrets)
  latest.markSecretsMigrated(migrated)
  latest.setSecretMigrationError(failed > 0 || tmdbFailed ? SECRET_MIGRATION_FAILED_MESSAGE : null)
  latest.setSecretStoreError(null)
  // Sources stopped while their secret could not be read start over.
  if (recovering) latest.requestSourceReconnect()
  return true
}

interface SourceAttempt {
  phase: 'connecting' | 'waiting' | 'stopped'
  failures: number
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * On app startup, connects every saved source: Xtream sources sign in, M3U
 * URL sources download their playlist, M3U file sources read their file again.
 *
 * A source that fails is retried on a timer with backoff (3 s, 6 s, 12 s ...
 * up to a minute), so a provider that was down at startup is picked up once it
 * is back without the user doing anything. A refused account, a missing secret
 * and an unreadable file stop the retries: they need the user. "Yeniden Dene"
 * (`requestSourceReconnect`) starts every source over at once.
 */
export function useAutoConnect() {
  // Set up before the secrets are in: the cache read starts the moment they are.
  watchCatalogCache()
  const hydratingRef = useRef(false)
  const attemptsRef = useRef(new Map<string, SourceAttempt>())
  const lastRetryTokenRef = useRef(0)
  const inFlightRef = useRef(0)
  const aliveRef = useRef(true)
  const sources = useStore((s) => s.sources)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const authedKey = useStore((s) => authedSourcesKey(s.xtreamAuth))
  const sourcesWithCatalog = useStore((s) => sourcesWithCatalogKey(s.catalogStatus))
  const credentialsHydrated = useStore((s) => s.credentialsHydrated)
  const connectRetryToken = useStore((s) => s.connectRetryToken)
  const secretStoreError = useStore((s) => s.secretStoreError)
  const hydrationFailuresRef = useRef(0)
  const [hydrationFailures, countHydrationFailure] = useReducer((value: number) => value + 1, 0)
  const lastHydrationRetryTokenRef = useRef(connectRetryToken)

  const runHydration = useCallback(() => {
    if (hydratingRef.current) return
    hydratingRef.current = true
    void hydrateSecrets()
      .then((ok) => {
        if (ok) {
          hydrationFailuresRef.current = 0
          return
        }
        hydrationFailuresRef.current += 1
        countHydrationFailure()
      })
      .finally(() => {
        hydratingRef.current = false
      })
  }, [])

  useEffect(() => {
    if (!credentialsHydrated) runHydration()
  }, [credentialsHydrated, runHydration])

  // An unreadable secure store (a lock held by an antivirus scan, say) is read
  // again with the same backoff as a provider; "Yeniden Dene" reads it at once.
  useEffect(() => {
    if (!secretStoreError) return
    const timer = setTimeout(runHydration, reconnectDelayMs(hydrationFailuresRef.current))
    return () => clearTimeout(timer)
  }, [secretStoreError, hydrationFailures, runHydration])

  useEffect(() => {
    if (connectRetryToken === lastHydrationRetryTokenRef.current) return
    lastHydrationRetryTokenRef.current = connectRetryToken
    if (useStore.getState().secretStoreError) runHydration()
  }, [connectRetryToken, runHydration])

  useEffect(() => {
    if (!activeSourceId && sources.length > 0) useStore.getState().setActiveSource(sources[0].id)
  }, [activeSourceId, sources])

  useEffect(() => {
    if (!credentialsHydrated) return
    const attempts = attemptsRef.current
    const authed = new Set(authedKey ? authedKey.split('\n') : [])
    const withCatalog = new Set(sourcesWithCatalog ? sourcesWithCatalog.split('\n') : [])
    const known = new Map(sources.map((source) => [source.id, source]))

    const forget = (sourceId: string) => {
      const attempt = attempts.get(sourceId)
      if (attempt?.timer) clearTimeout(attempt.timer)
      attempts.delete(sourceId)
    }

    const publishSummary = () => {
      const state = useStore.getState()
      state.setAuthError(connectionSummary(state.sources, state.sourceErrors))
    }

    const userRetry = connectRetryToken !== lastRetryTokenRef.current
    lastRetryTokenRef.current = connectRetryToken
    if (userRetry) for (const sourceId of [...attempts.keys()]) if (attempts.get(sourceId)?.phase !== 'connecting') forget(sourceId)

    const start = (sourceId: string, visible: boolean) => {
      const source = useStore.getState().sources.find((item) => item.id === sourceId)
      if (!source) return
      const attempt = attempts.get(sourceId) ?? { phase: 'connecting', failures: 0, timer: null }
      attempt.phase = 'connecting'
      attempt.timer = null
      attempts.set(sourceId, attempt)

      // Only the first attempt and the user's retries hold the dashboard on
      // "Kaynaklar bağlanıyor..."; timer retries run behind the error panel.
      if (visible) {
        inFlightRef.current += 1
        useStore.getState().setAuthLoading(true)
      }
      const state = useStore.getState()
      void connectSource(source, { setXtreamAuth: state.setXtreamAuth, secretsUnavailable: state.secretStoreError !== null })
        .then(
          () => {
            if (attempts.get(sourceId) !== attempt) return
            attempts.delete(sourceId)
            useStore.getState().setSourceError(sourceId, null)
          },
          (error: unknown) => {
            if (attempts.get(sourceId) !== attempt) return
            attempt.failures += 1
            const failure = describeConnectFailure(error, attempt.failures, Date.now())
            useStore.getState().setSourceError(sourceId, failure)
            if (failure.retryAt === null) {
              attempt.phase = 'stopped'
              return
            }
            attempt.phase = 'waiting'
            if (!aliveRef.current) return
            attempt.timer = setTimeout(() => {
              if (attempts.get(sourceId) !== attempt) return
              start(sourceId, false)
            }, failure.retryAt - Date.now())
          }
        )
        .finally(() => {
          publishSummary()
          if (!visible) return
          inFlightRef.current -= 1
          if (inFlightRef.current === 0) useStore.getState().setAuthLoading(false)
        })
    }

    for (const sourceId of [...attempts.keys()]) if (!known.has(sourceId)) forget(sourceId)
    for (const source of sources) {
      if (!needsConnection(source, authed, withCatalog)) {
        // Connected some other way meanwhile (the source manager's refresh).
        forget(source.id)
        useStore.getState().setSourceError(source.id, null)
        continue
      }
      if (!attempts.has(source.id)) start(source.id, true)
    }
    publishSummary()
  }, [credentialsHydrated, sources, authedKey, sourcesWithCatalog, connectRetryToken])

  useEffect(() => {
    const attempts = attemptsRef.current
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      // An attempt in flight stays known, so a remount (React's development
      // double mount) does not send the same request again.
      for (const [sourceId, attempt] of attempts) {
        if (attempt.timer) clearTimeout(attempt.timer)
        if (attempt.phase !== 'connecting') attempts.delete(sourceId)
      }
    }
  }, [])
}
