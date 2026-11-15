import { PlaylistRequestError } from '@/services/m3u-parser'
import { tlsListUntrusted, type UntrustedCertificateNotice } from '@/services/platform'
import { USER_ERROR_MESSAGES } from '@/services/user-error'
import { XtreamRequestError } from '@/services/xtream-errors'

/**
 * A request refused for its TLS certificate fails in the page like any
 * network error ("Failed to fetch"); only main knows why. Main records the
 * refusal before the request fails, so asking it afterwards is reliable: a
 * network error whose host main refused a certificate for becomes a
 * `certificate` error, which the user-error mapper turns into the certificate
 * message (and which is not retried on a timer: the trust dialog fixes it).
 */
export async function certificateAwareError(
  error: unknown,
  listUntrusted: () => Promise<UntrustedCertificateNotice[]> = tlsListUntrusted
): Promise<unknown> {
  const like = error as { kind?: unknown; host?: unknown } | null
  if (!like || typeof like !== 'object' || like.kind !== 'network' || typeof like.host !== 'string') return error
  let notices: UntrustedCertificateNotice[]
  try {
    notices = await listUntrusted()
  } catch {
    return error
  }
  const host = like.host
  if (!notices.some((notice) => notice.host === host)) return error
  const message = USER_ERROR_MESSAGES.certificate
  if (error instanceof PlaylistRequestError) return new PlaylistRequestError('certificate', message, { host, cause: error })
  return new XtreamRequestError('certificate', message, { host, cause: error })
}
