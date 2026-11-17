import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { addonErrorMessage } from '@/addons/messages'
import { hasChosenAddonStream } from '@/addons/stream-registry'
import {
  addonStreamPreferenceFor,
  collectAddonStreams,
  rememberAddonStreamChoice,
  streamAddonsFor,
  type AddonStreamCandidate
} from '@/addons/streams'
import { mpvIsAvailable } from '@/services/platform'
import type { Channel } from '@/types/playlist'
import { mediaKey, type AddonPlaybackTarget } from '../../../../shared/playback'
import { AddonStreamPicker } from './AddonStreamPicker'
import { applyStreamResult, decideAutoPick, initialPickerState, type StreamPickerState } from './stream-picker-model'

/**
 * How long a remembered choice may be looked for before the picker shows
 * what has come so far. Short: a fast add-on plays the next episode without
 * the sheet flashing up, a slow one does not leave the viewer staring at
 * nothing.
 */
export const AUTO_PICK_GRACE_MS = 700

export interface AddonPlayRequest {
  target: AddonPlaybackTarget
  /** What the player shows (its `streamUrl` is empty). */
  channel: Channel
  /** Called once playback started: open the player, typically. */
  onStarted?: () => void
}

interface PickerSession {
  id: number
  request: AddonPlayRequest
  /** Bumped by "Tekrar Dene": the add-ons are asked again. */
  attempt: number
  /** Null until the add-ons are asked (their addresses may still be loading). */
  picker: StreamPickerState | null
  /** The remembered choice may still be played without the viewer choosing. */
  auto: boolean
  visible: boolean
  /** Where the focus goes back to when the sheet is closed without playing. */
  returnFocus: HTMLElement | null
}

let mpvCheck: Promise<boolean> | null = null

/** Whether mpv is missing (checked once per app run). */
function useMpvMissing(active: boolean): boolean {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    mpvCheck ??= mpvIsAvailable().catch(() => false)
    void mpvCheck.then((available) => {
      if (!cancelled) setMissing(!available)
    })
    return () => {
      cancelled = true
    }
  }, [active])
  return missing
}

function addonName(source: { name: string; addon?: { name: string } }): string {
  return source.name || source.addon?.name || ''
}

let sessionCounter = 0

export interface AddonPlayback {
  /**
   * Plays an add-on film or episode: at once with the stream chosen for it
   * in this session, else through the picker (or, for the next episode, the
   * remembered add-on and release by itself).
   */
  play: (request: AddonPlayRequest) => void
  /** Opens the picker even when a stream was chosen (the player's "Yayınlar"). */
  chooseAgain: (request: AddonPlayRequest) => void
  /** The picker sheet while it is open; render it anywhere. */
  picker: ReactNode
}

/**
 * Choosing among the add-ons' streams and starting playback with the
 * candidate chosen. Every screen that starts add-on playback renders the
 * returned `picker`.
 */
export function useAddonPlayback(): AddonPlayback {
  const navigate = useNavigate()
  const startPlayback = useStore((s) => s.startPlayback)
  const playAddonStream = useStore((s) => s.playAddonStream)
  const credentialsHydrated = useStore((s) => s.credentialsHydrated)
  const [session, setSession] = useState<PickerSession | null>(null)
  const sessionRef = useRef<PickerSession | null>(null)
  useEffect(() => {
    sessionRef.current = session
  })

  const update = useCallback((id: number, change: (current: PickerSession) => PickerSession) => {
    setSession((current) => (current && current.id === id ? change(current) : current))
  }, [])

  const open = useCallback((request: AddonPlayRequest, remembered: boolean) => {
    const preference = remembered ? addonStreamPreferenceFor(request.target) : null
    const auto = !!preference?.bingeGroup
    sessionCounter += 1
    setSession({
      id: sessionCounter,
      request,
      attempt: 0,
      picker: null,
      auto,
      visible: !auto,
      returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null
    })
  }, [])

  const play = useCallback(
    (request: AddonPlayRequest) => {
      if (hasChosenAddonStream(request.target)) {
        startPlayback({ target: request.target, channel: request.channel })
        if (useStore.getState().currentPlayback?.mediaKey === mediaKey(request.target)) request.onStarted?.()
        return
      }
      open(request, true)
    },
    [open, startPlayback]
  )

  const chooseAgain = useCallback((request: AddonPlayRequest) => open(request, false), [open])

  const close = useCallback(() => {
    const current = sessionRef.current
    setSession(null)
    const target = current?.returnFocus
    if (target) requestAnimationFrame(() => {
      if (target.isConnected) target.focus()
    })
  }, [])

  const choose = useCallback(
    (candidate: AddonStreamCandidate) => {
      const current = sessionRef.current
      if (!current) return
      const { target, channel, onStarted } = current.request
      rememberAddonStreamChoice(target, candidate)
      playAddonStream({ target, channel, handle: candidate.handle })
      setSession(null)
      if (useStore.getState().currentPlayback?.mediaKey === mediaKey(target)) onStarted?.()
    },
    [playAddonStream]
  )

  // Ask every stream add-on, once their addresses are in memory. Closing the
  // sheet (or asking again) cancels whatever has not answered.
  const sessionId = session?.id ?? null
  const attempt = session?.attempt ?? 0
  useEffect(() => {
    const current = sessionRef.current
    if (sessionId === null || !current || current.id !== sessionId || !credentialsHydrated) return
    const controller = new AbortController()
    const { target } = current.request
    const sources = useStore.getState().sources
    const addons = streamAddonsFor(sources, target).map((source) => ({ sourceId: source.id, addonName: addonName(source) }))
    update(sessionId, (state) => ({ ...state, picker: initialPickerState(addons) }))
    void collectAddonStreams(target, {
      sources,
      signal: controller.signal,
      onResult: (result) => {
        if (controller.signal.aborted) return
        update(sessionId, (state) =>
          state.picker ? { ...state, picker: applyStreamResult(state.picker, result, (error) => addonErrorMessage(error)) } : state
        )
      }
    })
    return () => controller.abort()
  }, [sessionId, attempt, credentialsHydrated, update])

  // The remembered choice: played as soon as its add-on offers it again;
  // otherwise the sheet shows (at once when it cannot be found).
  useEffect(() => {
    if (!session?.auto || !session.picker) return
    const decision = decideAutoPick(session.picker, addonStreamPreferenceFor(session.request.target))
    if (decision.kind === 'play') choose(decision.candidate)
    else if (decision.kind === 'ask') update(session.id, (state) => ({ ...state, auto: false, visible: true }))
  }, [session, choose, update])

  const hiddenId = session && !session.visible ? session.id : null
  useEffect(() => {
    if (hiddenId === null) return
    const timer = window.setTimeout(() => update(hiddenId, (state) => ({ ...state, visible: true })), AUTO_PICK_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [hiddenId, update])

  const mpvMissing = useMpvMissing(!!session?.visible)

  const retry = useCallback(() => {
    const current = sessionRef.current
    if (current) update(current.id, (state) => ({ ...state, attempt: state.attempt + 1, picker: null }))
  }, [update])

  const interact = useCallback(() => {
    const current = sessionRef.current
    if (current?.auto) update(current.id, (state) => ({ ...state, auto: false }))
  }, [update])

  const openSettings = useCallback(() => {
    setSession(null)
    void navigate('/settings?tab=sources')
  }, [navigate])

  const picker =
    session && session.visible ? (
      <AddonStreamPicker
        itemName={session.request.channel.name}
        picker={session.picker}
        autoWaiting={session.auto}
        mpvMissing={mpvMissing}
        onChoose={choose}
        onClose={close}
        onRetry={retry}
        onOpenSettings={openSettings}
        onInteract={interact}
      />
    ) : null

  return { play, chooseAgain, picker }
}
