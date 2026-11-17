import { certificateAwareError } from '@/catalog/certificate-errors'
import { toCatalogSyncError } from '@/catalog/sync-error'
import type { CatalogSyncError } from '@/catalog/types'
import { USER_ERROR_MESSAGES } from '@/services/user-error'
import { XtreamRequestError, requestHost } from '@/services/xtream-errors'
import type { PlaylistSource } from '@/types/playlist'
import type { AddonPlaybackTarget } from '../../../shared/playback'
import { fetchAddonStreams, type AddonFetchOptions, type AddonStream } from './client'
import { addonSupports } from './manifest'
import { registerAddonStreamUrl } from './stream-registry'

/*
 * Streams for one film or episode, asked of every installed add-on whose
 * `stream` resource accepts the item's type and id, whichever add-on the
 * catalogue came from. The add-ons are asked in parallel, each with its own
 * time limit, and each answer is handed over as it arrives, so the list can
 * grow on screen. Candidates carry no URL, only a handle for the registry.
 */

/** Time each add-on gets to answer a stream request. */
export const ADDON_STREAM_TIMEOUT_MS = 12_000

/** One playable stream offered by one add-on, as the picker shows it. */
export interface AddonStreamCandidate {
  /** Opaque: `chooseAddonStream(target, handle)` turns it into the URL. */
  handle: string
  /** The add-on that offered it. */
  sourceId: string
  addonName: string
  /** As the add-on wrote them; shown as text. */
  name: string | null
  description: string | null
  bingeGroup: string | null
  filename: string | null
  videoSize: number | null
  notWebReady: boolean
}

/** What one add-on answered: candidates, nothing playable, or a failure. */
export type AddonStreamResult =
  | { sourceId: string; addonName: string; status: 'candidates'; candidates: AddonStreamCandidate[] }
  | { sourceId: string; addonName: string; status: 'empty' }
  | { sourceId: string; addonName: string; status: 'failed'; error: CatalogSyncError }

/**
 * The add-ons to ask for the target's streams: `addon` sources whose address
 * is loaded and whose `stream` resource takes the type and the video id.
 */
export function streamAddonsFor(sources: readonly PlaylistSource[], target: AddonPlaybackTarget): PlaylistSource[] {
  return sources.filter(
    (source) =>
      source.type === 'addon' &&
      !!source.url &&
      !!source.addon &&
      addonSupports(source.addon, 'stream', target.contentType, target.videoId)
  )
}

/** The display name of an add-on source: the name the user gave it, else the manifest's. */
function addonNameOf(source: PlaylistSource): string {
  return source.name || source.addon?.name || ''
}

function toCandidate(source: PlaylistSource, target: AddonPlaybackTarget, stream: AddonStream): AddonStreamCandidate {
  return {
    handle: registerAddonStreamUrl(target, stream.url),
    sourceId: source.id,
    addonName: addonNameOf(source),
    name: stream.name,
    description: stream.description,
    bingeGroup: stream.bingeGroup,
    filename: stream.filename,
    videoSize: stream.videoSize,
    notWebReady: stream.notWebReady
  }
}

export interface CollectStreamsOptions {
  /** Every configured source; the stream-capable add-ons are picked from them. */
  sources: readonly PlaylistSource[]
  /** Per add-on; default `ADDON_STREAM_TIMEOUT_MS`. */
  timeoutMs?: number
  /** Cancels every request (the picker was closed). */
  signal?: AbortSignal
  /** Called with each add-on's result as it arrives. */
  onResult?: (result: AddonStreamResult) => void
  /** Tests replace the network. */
  fetchStreams?: (base: string, type: string, videoId: string, options: AddonFetchOptions) => Promise<AddonStream[]>
}

/**
 * Asks every stream-capable add-on for the target's streams. Resolves with
 * one result per add-on asked, in the order of `sources`, once all have
 * answered or timed out; never rejects. A cancelled collection reports the
 * add-ons that had not answered as failed with kind `aborted`.
 */
export async function collectAddonStreams(target: AddonPlaybackTarget, options: CollectStreamsOptions): Promise<AddonStreamResult[]> {
  const fetchStreams = options.fetchStreams ?? fetchAddonStreams
  const timeoutMs = options.timeoutMs ?? ADDON_STREAM_TIMEOUT_MS
  const addons = streamAddonsFor(options.sources, target)

  return Promise.all(
    addons.map(async (source): Promise<AddonStreamResult> => {
      const base = source.url ?? ''
      const addonName = addonNameOf(source)
      // Each add-on's own limit, whatever the request does with `timeoutMs`;
      // the picker's cancel reaches every request.
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      const onCancel = () => controller.abort()
      if (options.signal?.aborted) controller.abort()
      else options.signal?.addEventListener('abort', onCancel, { once: true })

      let result: AddonStreamResult
      try {
        const streams = await fetchStreams(base, target.contentType, target.videoId, { signal: controller.signal, timeoutMs })
        if (controller.signal.aborted) throw new XtreamRequestError('aborted', USER_ERROR_MESSAGES.cancelled)
        result =
          streams.length > 0
            ? { sourceId: source.id, addonName, status: 'candidates', candidates: streams.map((stream) => toCandidate(source, target, stream)) }
            : { sourceId: source.id, addonName, status: 'empty' }
      } catch (caught) {
        const error = timedOut ? new XtreamRequestError('timeout', USER_ERROR_MESSAGES.timeout, { host: requestHost(base) }) : caught
        // `toCatalogSyncError` has nothing for a cancel; here it is a result like any other.
        const failure: CatalogSyncError = toCatalogSyncError(await certificateAwareError(error)) ?? {
          kind: 'aborted',
          message: USER_ERROR_MESSAGES.cancelled,
          retryable: true
        }
        result = { sourceId: source.id, addonName, status: 'failed', error: failure }
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onCancel)
      }
      options.onResult?.(result)
      return result
    })
  )
}

// ---------------------------------------------------------------------------
// The viewer's last choice, to pick the next episode's stream by itself.

/** Non-secret: which add-on and which `bingeGroup` the viewer chose. */
export interface AddonStreamPreference {
  sourceId: string
  bingeGroup: string | null
}

const preferences = new Map<string, AddonStreamPreference>()

function preferenceKey(target: AddonPlaybackTarget): string {
  return `${target.sourceId}\n${target.contentType}\n${target.metaId}`
}

/** Remembers (for this session) what the viewer chose for this film or series. */
export function rememberAddonStreamChoice(target: AddonPlaybackTarget, candidate: AddonStreamCandidate): void {
  preferences.set(preferenceKey(target), { sourceId: candidate.sourceId, bingeGroup: candidate.bingeGroup })
}

export function addonStreamPreferenceFor(target: AddonPlaybackTarget): AddonStreamPreference | null {
  return preferences.get(preferenceKey(target)) ?? null
}

/** Tests: forget every remembered choice. */
export function forgetAddonStreamPreferences(): void {
  preferences.clear()
}

/**
 * The candidate to play without asking: the first one from the same add-on
 * with the same `bingeGroup` as the remembered choice. Null without a
 * preference, without a binge group, or without such a candidate.
 */
export function pickPreferredCandidate(
  candidates: readonly AddonStreamCandidate[],
  preference: AddonStreamPreference | null
): AddonStreamCandidate | null {
  if (!preference?.bingeGroup) return null
  return (
    candidates.find(
      (candidate) => candidate.sourceId === preference.sourceId && candidate.bingeGroup === preference.bingeGroup
    ) ?? null
  )
}
