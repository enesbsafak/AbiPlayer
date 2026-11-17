import { toUserMessage } from '@/services/user-error'
import { errors } from '@/strings/errors'

/*
 * What an add-on's failure is called on screen. Add-on requests fail with
 * the Xtream request kinds (see request.ts), whose 401/403 reads as a wrong
 * user name or password; an add-on has neither (its settings are in its
 * address), so a refusal gets its own sentence. Everything else keeps the
 * app's usual wording. No message here ever holds an address.
 */

interface FailureLike {
  kind?: unknown
  status?: unknown
  message?: unknown
}

function asFailure(error: unknown): FailureLike | null {
  return error && typeof error === 'object' ? (error as FailureLike) : null
}

/** The add-on refused the request (HTTP 401 or 403). */
export function isAddonRefusal(error: unknown): boolean {
  const failure = asFailure(error)
  if (!failure) return false
  if (failure.status === 401 || failure.status === 403) return true
  return failure.kind === 'auth'
}

/**
 * One sentence for an add-on failure: an `XtreamRequestError` from the
 * client, or a `CatalogSyncError` the pager or the stream collection left.
 */
export function addonErrorMessage(error: unknown, fallback?: string): string {
  if (isAddonRefusal(error)) return errors.addonRefused
  return toUserMessage(error, fallback)
}
