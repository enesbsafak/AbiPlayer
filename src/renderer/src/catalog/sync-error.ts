import { isXtreamRequestError } from '@/services/xtream-errors'
import { toUserMessage } from '@/services/user-error'
import type { CatalogSyncError } from './types'
import { strings } from '@/strings'

function isAbortError(error: unknown): boolean {
  return (
    (isXtreamRequestError(error) && error.kind === 'aborted') ||
    (error instanceof DOMException && error.name === 'AbortError')
  )
}

/**
 * The status a failed sync leaves behind, or null for a cancelled one (a
 * cancelled sync is not an error: its source was removed or refreshed).
 * Typed Xtream errors keep their kind and retryability; anything else is
 * reported as an unknown, retryable failure with a safe Turkish message.
 */
export function toCatalogSyncError(error: unknown): CatalogSyncError | null {
  if (isAbortError(error)) return null
  if (isXtreamRequestError(error)) {
    return {
      kind: error.kind,
      message: error.message,
      retryable: error.retryable,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...((error as { origin?: unknown }).origin === 'tmdb' ? { origin: 'tmdb' as const } : {})
    }
  }
  return {
    kind: 'unknown',
    message: toUserMessage(error, strings.catalog.page.contentSyncFailed),
    retryable: true
  }
}
