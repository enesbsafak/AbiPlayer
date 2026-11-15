import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@/store'
import { catalog as defaultCatalog, type CatalogStore } from '@/catalog/catalog-store'
import { CATALOG_TYPES } from '@/catalog/types'
import type { Channel } from '@/types/playlist'
import { strings } from '@/strings'

export interface DeferredPlayRequest {
  sourceId: string
  /** Shown while waiting. */
  name: string
  /** The playable item, once the source's catalog has it; null while it does not. */
  resolve: () => Channel | null
}

export interface DeferredPlayNotice {
  message: string
  /** Still waiting for the playlist (as opposed to a final answer). */
  pending: boolean
}

export const ENTRY_GONE_MESSAGE = strings.player.deferred.entryGone

function sourceLoaded(store: CatalogStore, sourceId: string): boolean {
  return CATALOG_TYPES.some((type) => store.getStatus(sourceId, type)?.loaded === true)
}

export type DeferredPlayStep =
  | { kind: 'play'; channel: Channel }
  | { kind: 'final'; message: string }
  | { kind: 'wait' }

/** What to do with a request right now: play it, give up with a message, or keep waiting. */
export function deferredPlayStep(
  request: DeferredPlayRequest,
  store: CatalogStore,
  sourceError: { message: string; retryAt: number | null } | undefined,
  sourceExists: boolean
): DeferredPlayStep {
  const channel = request.resolve()
  if (channel) return { kind: 'play', channel }
  if (!sourceExists) return { kind: 'final', message: strings.player.deferred.sourceGone }
  if (sourceLoaded(store, request.sourceId)) return { kind: 'final', message: ENTRY_GONE_MESSAGE }
  // Not retried on a timer: the source needs the user (wrong password, missing file).
  if (sourceError && sourceError.retryAt === null) return { kind: 'final', message: sourceError.message }
  return { kind: 'wait' }
}

/**
 * Plays an item that stored history or favourites list without its URL (M3U
 * entries keep only their id) as soon as its playlist is loaded. The card is
 * shown right away; clicking it before the playlist is in waits for it,
 * nudging the source to connect again if it had failed, and plays then.
 */
export function useDeferredPlayback(store: CatalogStore = defaultCatalog) {
  const [notice, setNotice] = useState<DeferredPlayNotice | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const cancelPending = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
  }, [])

  const playWhenReady = useCallback(
    (request: DeferredPlayRequest, play: (channel: Channel) => void) => {
      cancelPending()
      const check = (): boolean => {
        const state = useStore.getState()
        const step = deferredPlayStep(
          request,
          store,
          state.sourceErrors[request.sourceId],
          state.sources.some((source) => source.id === request.sourceId)
        )
        if (step.kind === 'wait') return false
        if (step.kind === 'play') {
          setNotice(null)
          play(step.channel)
        } else {
          setNotice({ message: step.message, pending: false })
        }
        return true
      }
      if (check()) return

      setNotice({ message: strings.player.deferred.loading(request.name), pending: true })
      // A source that is waiting for its next automatic attempt is asked to try now.
      if (useStore.getState().sourceErrors[request.sourceId]) useStore.getState().requestSourceReconnect()

      let done = false
      const finish = () => {
        if (done) return
        done = true
        unsubscribeCatalog()
        unsubscribeStore()
        if (cancelRef.current === finish) cancelRef.current = null
      }
      // A playlist swap writes its three lists one after another: look once it
      // is done, not after the first list (which would report the entry gone).
      let checkQueued = false
      const unsubscribeCatalog = store.subscribe((change) => {
        if (change.sourceId !== request.sourceId || checkQueued) return
        checkQueued = true
        queueMicrotask(() => {
          checkQueued = false
          if (!done && check()) finish()
        })
      })
      const unsubscribeStore = useStore.subscribe((state, previous) => {
        // Something else started meanwhile: the viewer moved on, and playing
        // this one later would replace what they chose.
        const started = state.currentPlayback
        if (started && started.mediaKey !== previous.currentPlayback?.mediaKey) {
          finish()
          setNotice(null)
          return
        }
        if (state.sourceErrors === previous.sourceErrors && state.sources === previous.sources) return
        if (check()) finish()
      })
      cancelRef.current = finish
    },
    [cancelPending, store]
  )

  useEffect(() => cancelPending, [cancelPending])

  const dismissNotice = useCallback(() => {
    cancelPending()
    setNotice(null)
  }, [cancelPending])

  return { playWhenReady, notice, dismissNotice }
}
