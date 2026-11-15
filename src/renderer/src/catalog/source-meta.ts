/*
 * Per-source facts that are not catalog records and must not be persisted in
 * clear: the guide URLs an M3U playlist names in its header (they usually
 * carry the account's credentials). Kept in memory only; on disk they exist
 * only sealed, inside the M3U cache.
 */

const epgUrls = new Map<string, string[]>()
const listeners = new Set<() => void>()

export function setSourceEpgUrls(sourceId: string, urls: readonly string[]): void {
  const current = epgUrls.get(sourceId)
  if (current && current.length === urls.length && current.every((url, index) => url === urls[index])) return
  if (urls.length === 0) epgUrls.delete(sourceId)
  else epgUrls.set(sourceId, [...urls])
  for (const listener of [...listeners]) listener()
}

/** The first guide URL of an M3U source's playlist header, if it named one. */
export function sourceEpgUrl(sourceId: string): string | null {
  return epgUrls.get(sourceId)?.[0] ?? null
}

export function forgetSourceMeta(sourceId: string): void {
  if (epgUrls.delete(sourceId)) for (const listener of [...listeners]) listener()
}

export function subscribeSourceMeta(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
