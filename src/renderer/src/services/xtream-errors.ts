export type XtreamErrorKind = 'network' | 'timeout' | 'auth' | 'http' | 'bad-response' | 'aborted' | 'certificate'

export const XTREAM_REQUEST_CANCELLED_MESSAGE = 'İstek iptal edildi'

/**
 * Every failure of an Xtream request surfaces as this one class, so callers
 * can branch on `kind` (show "Tekrar Dene" for network/timeout, send the user
 * to the source settings for auth, stay silent for aborted) instead of
 * matching message text. `message` is always Turkish and safe to show: it
 * never contains credentials.
 *
 * `certificate`: the request failed because main refused the server's TLS
 * certificate (see `certificateAwareError`); the trust dialog, not a timer,
 * fixes it.
 */
export class XtreamRequestError extends Error {
  readonly kind: XtreamErrorKind
  /** HTTP status for `http` and `auth` errors raised from a response. */
  readonly status?: number
  /**
   * Lower-case host of the request (no port, IPv6 without brackets), so a
   * network failure can be matched against a refused certificate.
   */
  readonly host?: string

  constructor(
    kind: XtreamErrorKind,
    message: string,
    options: { status?: number; cause?: unknown; host?: string } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'XtreamRequestError'
    this.kind = kind
    this.status = options.status
    if (options.host) this.host = options.host
  }

  /** Transient failures worth retrying: the next attempt may well succeed. */
  get retryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true
    if (this.kind !== 'http' || this.status === undefined) return false
    return this.status === 408 || this.status === 429 || this.status >= 500
  }
}

export function isXtreamRequestError(error: unknown): error is XtreamRequestError {
  return error instanceof XtreamRequestError
}

export function badResponseError(message: string): XtreamRequestError {
  return new XtreamRequestError('bad-response', message)
}

/** The host of a request URL as main's TLS policy reports it, or undefined. */
export function requestHost(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
    return host || undefined
  } catch {
    return undefined
  }
}
