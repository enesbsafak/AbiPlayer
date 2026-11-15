import type { XtreamCredentials } from '@/types/xtream'
import { XTREAM_REQUEST_CANCELLED_MESSAGE, XtreamRequestError, requestHost } from './xtream-errors'

/*
 * The network half of the Xtream client: URL building, one request with
 * header and body-inactivity timeouts, retries with backoff, typed errors.
 * Imports nothing that needs the DOM or React, so the catalog worker uses it
 * as is; `xtream-api.ts` adds the request cache and in-flight sharing on top.
 */

/** Time allowed until the response headers arrive. */
export const XTREAM_HEADERS_TIMEOUT_MS = 20_000
/**
 * Header window for whole-catalog calls (no category_id): panels build the
 * complete JSON before sending the first byte, which takes longer than any
 * single-category answer.
 */
export const XTREAM_FULL_LIST_HEADERS_TIMEOUT_MS = 45_000
/**
 * Time the body may go without receiving a single byte. There is no fixed
 * total: a full catalog on a slow link keeps going as long as data flows.
 */
export const XTREAM_BODY_IDLE_TIMEOUT_MS = 30_000
export const XTREAM_DEFAULT_MAX_RETRIES = 2
const XTREAM_RETRY_BASE_DELAY_MS = 500

/**
 * Strip Xtream credentials from a URL so it is safe to include in logs or
 * user-visible error messages. Handles both the `player_api.php?username=&password=`
 * form and the positional `/live/<user>/<pass>/<id>.m3u8` form.
 */
export function maskCredentialsInUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('username')) parsed.searchParams.set('username', '***')
    if (parsed.searchParams.has('password')) parsed.searchParams.set('password', '***')

    // Positional /live|/movie|/series/<user>/<pass>/<id>.<ext>
    const positionalMatch = parsed.pathname.match(
      /^\/(live|movie|series)\/[^/]+\/[^/]+\/(.+)$/
    )
    if (positionalMatch) {
      parsed.pathname = `/${positionalMatch[1]}/***/***/${positionalMatch[2]}`
    }
    return parsed.toString()
  } catch {
    // Fallback: best-effort regex masking for malformed URLs
    return url
      .replace(/(\b(?:username|password)=)[^&#\s]*/gi, '$1***')
      .replace(/\/(live|movie|series)\/[^/]+\/[^/]+\//gi, '/$1/***/***/')
  }
}

export function buildUrl(creds: XtreamCredentials, action: string, params?: Record<string, string>): string {
  const base = creds.url.replace(/\/+$/, '')
  const url = new URL(`${base}/player_api.php`)
  url.searchParams.set('username', creds.username)
  url.searchParams.set('password', creds.password)
  if (action) url.searchParams.set('action', action)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  return url.toString()
}

/**
 * Positional stream URL. Username and password are path segments, so a `#`,
 * `/` or `?` in either would otherwise cut the URL short.
 */
export function buildStreamUrl(
  creds: XtreamCredentials,
  kind: 'live' | 'movie' | 'series',
  streamId: number,
  extension: string
): string {
  const base = creds.url.replace(/\/+$/, '')
  const user = encodeURIComponent(creds.username)
  const pass = encodeURIComponent(creds.password)
  return `${base}/${kind}/${user}/${pass}/${streamId}.${extension}`
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new XtreamRequestError('aborted', XTREAM_REQUEST_CANCELLED_MESSAGE))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new XtreamRequestError('aborted', XTREAM_REQUEST_CANCELLED_MESSAGE))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Read the body as text with a timeout that tracks progress: the clock is
 * reset by every chunk, so a large catalog on a slow but steady link
 * finishes, while a stalled connection fails after XTREAM_BODY_IDLE_TIMEOUT_MS.
 */
async function readBodyText(res: Response, requestSignal: AbortSignal, onIdle: () => void): Promise<string> {
  const reader = res.body?.getReader()
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(onIdle, XTREAM_BODY_IDLE_TIMEOUT_MS)
  }
  // A fetch body errors out when its request is aborted; cancelling the
  // reader as well guarantees a pending read settles either way.
  const cancelReader = () => {
    reader?.cancel().catch(() => undefined)
  }
  requestSignal.addEventListener('abort', cancelReader, { once: true })

  armIdleTimer()
  try {
    if (!reader) return await res.text()

    const decoder = new TextDecoder()
    const parts: string[] = []
    const readNext = async (): Promise<void> => {
      const { done, value } = await reader.read()
      if (done) return
      armIdleTimer()
      parts.push(decoder.decode(value, { stream: true }))
      await readNext()
    }
    await readNext()
    // A cancelled reader reports `done`, which must not pass for a full body.
    if (requestSignal.aborted) throw new DOMException('Aborted', 'AbortError')
    parts.push(decoder.decode())
    return parts.join('')
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    requestSignal.removeEventListener('abort', cancelReader)
  }
}

function describeHttpFailure(status: number, sample: string, host?: string): XtreamRequestError {
  const suffix = sample ? ` (${sample})` : ''
  if (status === 401 || status === 403) {
    return new XtreamRequestError(
      'auth',
      `Kimlik doğrulama başarısız oldu (HTTP ${status}). Kullanıcı adını, şifreyi ve hesap durumunu kontrol edin.${suffix}`,
      { status, host }
    )
  }
  return new XtreamRequestError('http', `Sunucu hata döndürdü (HTTP ${status})${suffix}`, { status, host })
}

/** Timing hook: called with a step name and the (credential-bearing) URL. */
export type RequestMark = (name: string, url: string) => void

export interface RawJsonResponse {
  data: unknown
  /** Body length in UTF-16 code units. */
  size: number
}

/** One network attempt: headers, body and JSON parse. */
async function requestOnce(
  url: string,
  signal: AbortSignal | undefined,
  headersTimeoutMs: number,
  mark: RequestMark
): Promise<RawJsonResponse> {
  const controller = new AbortController()
  const host = requestHost(url)
  const state: { timeoutPhase: 'headers' | 'body' | null } = { timeoutPhase: null }
  const headersTimer = setTimeout(() => {
    state.timeoutPhase = 'headers'
    controller.abort()
  }, headersTimeoutMs)
  const abortFromSignal = () => controller.abort()

  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abortFromSignal, { once: true })
  }

  try {
    // cache: no-store avoids stale responses from the HTTP cache.
    mark('xtream:request', url)
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal, mode: 'cors' })
    mark('xtream:response', url)
    clearTimeout(headersTimer)

    // Status first: `fetch` resolves on 4xx/5xx, so the body is only ever a
    // JSON payload once we know the request succeeded.
    if (!res.ok) {
      // Mask credentials in any echoed URL the server might include, so
      // 4xx/5xx errors don't print user:pass into the UI or logs.
      const errorBody = await res.text().catch(() => '')
      const sample = maskCredentialsInUrl(errorBody.slice(0, 160)).replace(/\s+/g, ' ').trim()
      throw describeHttpFailure(res.status, sample, host)
    }

    const body = await readBodyText(res, controller.signal, () => {
      state.timeoutPhase = 'body'
      controller.abort()
    })
    mark('xtream:body', url)

    try {
      const data: unknown = JSON.parse(body)
      mark('xtream:parsed', url)
      return { data, size: body.length }
    } catch {
      const sample = maskCredentialsInUrl(body.slice(0, 200)).replace(/\s+/g, ' ').trim()
      throw new XtreamRequestError(
        'bad-response',
        `Geçersiz sunucu yanıtı. JSON bekleniyordu: ${sample || 'boş gövde'}`,
        { host }
      )
    }
  } catch (error) {
    if (error instanceof XtreamRequestError) throw error
    if (state.timeoutPhase === 'headers') {
      throw new XtreamRequestError(
        'timeout',
        `İstek zaman aşımına uğradı: sunucu ${headersTimeoutMs / 1000} saniye içinde yanıt vermedi`,
        { cause: error, host }
      )
    }
    if (state.timeoutPhase === 'body') {
      throw new XtreamRequestError(
        'timeout',
        `İstek zaman aşımına uğradı: sunucudan ${XTREAM_BODY_IDLE_TIMEOUT_MS / 1000} saniyedir veri gelmiyor`,
        { cause: error, host }
      )
    }
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new XtreamRequestError('aborted', XTREAM_REQUEST_CANCELLED_MESSAGE, { cause: error })
    }
    throw new XtreamRequestError(
      'network',
      'Sunucuya bağlanılamadı. İnternet bağlantısını ve sunucu adresini kontrol edin.',
      { cause: error, host }
    )
  } finally {
    clearTimeout(headersTimer)
    if (signal) signal.removeEventListener('abort', abortFromSignal)
  }
}

/** Delay before retry number `retry` (1-based): 0.5 s, 1.5 s, 4.5 s ... */
export function xtreamRetryDelayMs(retry: number): number {
  return XTREAM_RETRY_BASE_DELAY_MS * 3 ** (retry - 1)
}

export async function requestWithRetry(
  url: string,
  signal: AbortSignal | undefined,
  maxRetries: number,
  headersTimeoutMs: number,
  mark: RequestMark = () => undefined
): Promise<RawJsonResponse> {
  const attempt = async (retry: number): Promise<RawJsonResponse> => {
    try {
      return await requestOnce(url, signal, headersTimeoutMs, mark)
    } catch (error) {
      if (!(error instanceof XtreamRequestError) || !error.retryable || retry >= maxRetries) throw error
      await sleep(xtreamRetryDelayMs(retry + 1), signal)
      return attempt(retry + 1)
    }
  }
  return attempt(0)
}

