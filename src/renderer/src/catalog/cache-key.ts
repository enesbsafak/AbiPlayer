/*
 * The M3U cache key reaches the worker once main has answered; an M3U job
 * posted before that would find no key and skip its cache write. Jobs that
 * seal data wait for it (briefly: without a key they still run, uncached).
 */

const KEY_WAIT_MS = 5_000

let ready: Promise<void> | null = null

/** Called by the cache's start-up with the promise that settles once the key was handed to the worker. */
export function setCacheKeyPending(pending: Promise<void>): void {
  ready = pending.catch(() => undefined)
}

export function cacheKeyReady(): Promise<void> {
  if (!ready) return Promise.resolve()
  return Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, KEY_WAIT_MS))])
}

