import { mediaKey, type AddonPlaybackTarget } from '../../../shared/playback'

/*
 * Stream URLs of add-on candidates, for this session only. A URL often holds
 * the add-on's personal key, so it is never persisted, never put in a
 * candidate object, a prop or the store's display data: candidates carry an
 * opaque handle, and the URL is looked up here by that handle when the
 * viewer picks one, and by media key when the playback resolves its URL.
 * After a restart nothing is here, and the viewer chooses again.
 */

/** Candidates remembered at most; the oldest are forgotten first. */
export const MAX_REGISTERED_CANDIDATES = 2_000

interface Registered {
  url: string
  /** Media key of the target the candidate was offered for. */
  mediaKey: string
}

const candidates = new Map<string, Registered>()
const chosen = new Map<string, string>()
let counter = 0

function newHandle(): string {
  counter += 1
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `c${counter.toString(36)}-${random}`
}

/** Keeps a candidate's URL for `target` and returns the handle that stands for it. */
export function registerAddonStreamUrl(target: AddonPlaybackTarget, url: string): string {
  const handle = newHandle()
  candidates.set(handle, { url, mediaKey: mediaKey(target) })
  while (candidates.size > MAX_REGISTERED_CANDIDATES) {
    const oldest = candidates.keys().next()
    if (oldest.done) break
    candidates.delete(oldest.value)
  }
  return handle
}

/**
 * The viewer picked the candidate `handle` for `target`: its URL becomes the
 * one this target plays until another is chosen. False when the handle is
 * unknown or was offered for another target.
 */
export function chooseAddonStream(target: AddonPlaybackTarget, handle: string): boolean {
  const entry = candidates.get(handle)
  const key = mediaKey(target)
  if (!entry || entry.mediaKey !== key) return false
  chosen.set(key, entry.url)
  return true
}

/** The URL chosen for a target in this session, or null (the viewer has to choose). */
export function chosenAddonStreamUrl(target: AddonPlaybackTarget): string | null {
  return chosen.get(mediaKey(target)) ?? null
}

/** Whether a stream was chosen for the target in this session. */
export function hasChosenAddonStream(target: AddonPlaybackTarget): boolean {
  return chosen.has(mediaKey(target))
}

/** Forgets the candidates and choices of targets whose catalogue source is `sourceId`, or everything. */
export function forgetAddonStreams(sourceId?: string): void {
  if (sourceId === undefined) {
    candidates.clear()
    chosen.clear()
    return
  }
  const prefix = `addon:${encodeURIComponent(sourceId)}:`
  for (const [handle, entry] of candidates) if (entry.mediaKey.startsWith(prefix)) candidates.delete(handle)
  for (const key of [...chosen.keys()]) if (key.startsWith(prefix)) chosen.delete(key)
}
