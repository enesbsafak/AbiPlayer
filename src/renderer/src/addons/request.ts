import { USER_ERROR_MESSAGES } from '@/services/user-error'
import { XTREAM_REQUEST_CANCELLED_MESSAGE, XtreamRequestError, requestHost } from '@/services/xtream-errors'
import { errors } from '@/strings/errors'

/*
 * One add-on request: GET, JSON, a time limit for the whole exchange and a
 * byte limit for the body. Failures surface as the app's `XtreamRequestError`
 * kinds (network, timeout, http, bad-response, aborted), so every screen and
 * helper that understands an Xtream failure (the user messages, the catalog
 * banners, the certificate check through `host`) understands these too.
 *
 * The URL carries the add-on's settings, so it never reaches a message, a
 * cause or a log: messages are the app's generic sentences, the only detail
 * attached is the host and the HTTP status, and no underlying error is kept
 * as `cause` (a JSON parse error quotes the body, which may echo the URL).
 */

export const ADDON_REQUEST_TIMEOUT_MS = 15_000

export interface AddonRequestOptions {
  signal?: AbortSignal
  /** Time for the whole request, headers and body; default `ADDON_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number
  /** Largest body accepted, in bytes. */
  maxBytes: number
  /** Tests replace the network. */
  fetchImpl?: typeof fetch
}

function badResponse(host: string | undefined): XtreamRequestError {
  return new XtreamRequestError('bad-response', USER_ERROR_MESSAGES['bad-response'], { host })
}

/** The body as text, refused (`bad-response`, no URL in it) past `maxBytes`. */
export async function readCapped(res: Response, maxBytes: number, host: string | undefined): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined)
    throw badResponse(host)
  }
  const reader = res.body?.getReader()
  if (!reader) {
    const text = await res.text()
    if (new TextEncoder().encode(text).length > maxBytes) throw badResponse(host)
    return text
  }
  const decoder = new TextDecoder()
  const parts: string[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw badResponse(host)
    }
    parts.push(decoder.decode(value, { stream: true }))
  }
  parts.push(decoder.decode())
  return parts.join('')
}

/** GETs `url` and parses its JSON body; rejects with an `XtreamRequestError` that holds no URL. */
export async function fetchAddonJson(url: string, options: AddonRequestOptions): Promise<unknown> {
  const host = requestHost(url)
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? ADDON_REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  const { signal } = options
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const doFetch = options.fetchImpl ?? fetch
    let res: Response
    try {
      res = await doFetch(url, {
        cache: 'no-store',
        credentials: 'omit',
        mode: 'cors',
        redirect: 'follow',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      })
    } catch {
      throw new XtreamRequestError('network', USER_ERROR_MESSAGES.network, { host })
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined)
      throw new XtreamRequestError('http', errors.kinds.httpRefused(res.status), { status: res.status, host })
    }
    let body: string
    try {
      body = await readCapped(res, options.maxBytes, host)
    } catch (error) {
      if (error instanceof XtreamRequestError) throw error
      throw new XtreamRequestError('network', USER_ERROR_MESSAGES.network, { host })
    }
    try {
      return JSON.parse(body) as unknown
    } catch {
      throw badResponse(host)
    }
  } catch (error) {
    // Whatever failed first, a timeout or a cancel is what it was.
    if (timedOut) throw new XtreamRequestError('timeout', USER_ERROR_MESSAGES.timeout, { host })
    if (signal?.aborted) throw new XtreamRequestError('aborted', XTREAM_REQUEST_CANCELLED_MESSAGE)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
