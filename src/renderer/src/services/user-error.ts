/**
 * Turns whatever a failed operation threw into one Turkish sentence a user can
 * act on.
 *
 * Without this the most common failures reached the screen as raw engine text:
 * "Failed to fetch", "signal is aborted without reason", or Electron's
 * "Error invoking remote method '…': Error: …" wrapper around an IPC error.
 */

export type UserErrorKind =
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'auth'
  | 'too-large'
  | 'http'
  | 'bad-response'
  | 'generic'

export const USER_ERROR_MESSAGES: Record<Exclude<UserErrorKind, 'http' | 'too-large'>, string> = {
  network: 'Sunucuya ulaşılamadı. İnternet bağlantınızı ve sunucu adresini kontrol edin.',
  timeout: 'Sunucu zamanında yanıt vermedi. Biraz sonra tekrar deneyin.',
  cancelled: 'İstek tamamlanmadan durduruldu. Tekrar deneyin.',
  auth: 'Kullanıcı adı veya şifre kabul edilmedi.',
  'bad-response': 'Sunucudan beklenmeyen bir yanıt geldi.',
  generic: 'Beklenmeyen bir hata oluştu.'
}

const ELECTRON_IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/i
const LEADING_ERROR_NAME = /^(?:[A-Za-z]*Error|DOMException):\s*/

// Kind names the typed Xtream errors may use. Several spellings are accepted
// because that layer is written separately; anything unknown falls through to
// message inspection.
const KIND_ALIASES: Record<string, UserErrorKind> = {
  network: 'network',
  offline: 'network',
  timeout: 'timeout',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  aborted: 'cancelled',
  abort: 'cancelled',
  auth: 'auth',
  authentication: 'auth',
  unauthorized: 'auth',
  http: 'http',
  'http-status': 'http',
  http_status: 'http',
  status: 'http',
  'bad-response': 'bad-response',
  bad_response: 'bad-response',
  badresponse: 'bad-response',
  'invalid-response': 'bad-response',
  parse: 'bad-response',
  'too-large': 'too-large',
  too_large: 'too-large',
  toolarge: 'too-large'
}

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network error|load failed|net::err_|err_internet_disconnected|err_name_not_resolved|err_connection|econnrefused|econnreset|enotfound|ehostunreach|getaddrinfo|bağlanılamadı|baglanilamadi|ulaşılamadı|ulasilamadi/i
const TIMEOUT_PATTERN = /timed? ?out|timeout|etimedout|zaman aşımı|zaman asimi/i
const CANCELLED_PATTERN =
  /signal is aborted|aborted|aborterror|the operation was aborted|user aborted|iptal edildi/i
const AUTH_PATTERN =
  /unauthori[sz]ed|forbidden|kimlik doğrulama|kimlik dogrulama|invalid credentials|auth(?:entication)? failed/i
const TOO_LARGE_PATTERN = /too large|çok büyük|cok buyuk|payload too/i
const HTTP_STATUS_PATTERN = /\bHTTP\s*(\d{3})\b|indirilemedi:?\s*(\d{3})\b/i
const BAD_RESPONSE_PATTERN =
  /unexpected token|unexpected end of json|not valid json|json bekleniyordu|geçersiz sunucu yanıtı|gecersiz sunucu yaniti/i
const SIZE_LIMIT_PATTERN = /(\d+(?:[.,]\d+)?\s*[KMG]B)/i
// Text that already reads as Turkish is the app's own wording and can be shown
// as is.
const TURKISH_TEXT_PATTERN = /[çğıöşüÇĞİÖŞÜ]/

interface ErrorLike {
  name?: unknown
  message?: unknown
  kind?: unknown
  status?: unknown
}

function asErrorLike(error: unknown): ErrorLike | null {
  if (!error || typeof error !== 'object') return null
  return error as ErrorLike
}

/** The message with Electron's IPC wrapper and a leading `XxxError:` removed. */
export function stripErrorPrefixes(message: string): string {
  let result = message.trim()
  if (ELECTRON_IPC_PREFIX.test(result)) {
    result = result.replace(ELECTRON_IPC_PREFIX, '')
    result = result.replace(LEADING_ERROR_NAME, '')
  }
  return result.trim()
}

function rawMessageOf(error: unknown): string {
  if (typeof error === 'string') return error
  const like = asErrorLike(error)
  if (like && typeof like.message === 'string') return like.message
  return ''
}

function httpStatusOf(error: unknown, message: string): number | null {
  const like = asErrorLike(error)
  if (like && typeof like.status === 'number' && Number.isFinite(like.status)) return like.status
  const match = message.match(HTTP_STATUS_PATTERN)
  const digits = match?.[1] ?? match?.[2]
  return digits ? Number.parseInt(digits, 10) : null
}

function kindFromProperty(error: unknown): UserErrorKind | null {
  const like = asErrorLike(error)
  if (!like || typeof like.kind !== 'string') return null
  return KIND_ALIASES[like.kind.trim().toLowerCase()] ?? null
}

function kindFromName(error: unknown): UserErrorKind | null {
  const like = asErrorLike(error)
  if (!like || typeof like.name !== 'string') return null
  if (like.name === 'AbortError') return 'cancelled'
  if (like.name === 'TimeoutError') return 'timeout'
  return null
}

function kindFromMessage(message: string, status: number | null): UserErrorKind | null {
  if (!message) return null
  if (TOO_LARGE_PATTERN.test(message) || status === 413) return 'too-large'
  if (AUTH_PATTERN.test(message) || status === 401 || status === 403) return 'auth'
  if (TIMEOUT_PATTERN.test(message)) return 'timeout'
  if (CANCELLED_PATTERN.test(message)) return 'cancelled'
  if (NETWORK_PATTERN.test(message)) return 'network'
  if (status !== null) return 'http'
  if (BAD_RESPONSE_PATTERN.test(message)) return 'bad-response'
  return null
}

/** Which of the user-facing categories an error belongs to. */
export function classifyError(error: unknown): UserErrorKind {
  const message = stripErrorPrefixes(rawMessageOf(error))
  const status = httpStatusOf(error, message)

  const fromKind = kindFromProperty(error)
  if (fromKind === 'http' && (status === 401 || status === 403)) return 'auth'
  if (fromKind === 'http' && status === 413) return 'too-large'
  if (fromKind) return fromKind

  return kindFromName(error) ?? kindFromMessage(message, status) ?? 'generic'
}

function messageForKind(kind: UserErrorKind, error: unknown, message: string): string {
  if (kind === 'http') {
    const status = httpStatusOf(error, message)
    return status !== null
      ? `Sunucu isteği reddetti (HTTP ${status}).`
      : 'Sunucu isteği reddetti.'
  }
  if (kind === 'too-large') {
    const limit = message.match(SIZE_LIMIT_PATTERN)?.[1]
    return limit ? `Liste veya dosya çok büyük (en fazla ${limit}).` : 'Liste veya dosya çok büyük.'
  }
  return USER_ERROR_MESSAGES[kind]
}

/**
 * A Turkish message for the user.
 *
 * `fallback` replaces the generic sentence when nothing more specific is known,
 * so a caller can say what failed ("İçe aktarma başarısız oldu").
 */
export function toUserMessage(error: unknown, fallback?: string): string {
  const message = stripErrorPrefixes(rawMessageOf(error))
  const kind = classifyError(error)

  if (kind !== 'generic') return messageForKind(kind, error, message)
  if (message && TURKISH_TEXT_PATTERN.test(message)) return message
  return fallback ?? USER_ERROR_MESSAGES.generic
}
