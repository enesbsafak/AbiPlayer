/**
 * The one reconnect policy for live streams, whichever engine plays them.
 *
 * Each engine reports what it observes — is the stream making progress, should
 * it be, did the engine report a failure — and the policy decides when to
 * reconnect, how long to wait first, when to give up, and what the viewer is
 * told. Engines differ only in how they measure progress and how they
 * reconnect.
 */

export const MAX_RECONNECT_ATTEMPTS = 5
/**
 * No progress for this long while playing counts as a stall. For mpv this
 * leaves its own reconnect (reconnect_delay_max=5s) two attempts before the
 * player reloads the stream.
 */
export const STALL_THRESHOLD_MS = 12_000
export const RECONNECT_BASE_DELAY_MS = 1_000
export const CONNECTION_LOST_MESSAGE = 'Yayın bağlantısı kesildi.'

export function reconnectingMessage(attempt: number): string {
  return `Bağlantı kesildi, yeniden bağlanılıyor... (${attempt}/${MAX_RECONNECT_ATTEMPTS})`
}

/** Waits grow with each attempt in a row: 1 s, 2 s, ... */
export function reconnectDelayMs(attempt: number): number {
  return RECONNECT_BASE_DELAY_MS * attempt
}

export interface ReconnectObservation {
  /** Only live streams are reconnected; a film's failure is shown as it is. */
  isLive: boolean
  /** The stream is moving right now (frames or time advancing). */
  progressing: boolean
  /** It should be: playing, not paused by the viewer. */
  expectingProgress: boolean
  /** A failure the engine reported for the current load, if any. */
  error: string | null
  /**
   * Identifies the load the error belongs to. An error already acted upon is
   * not acted upon again when a late report of it repeats.
   */
  errorKey?: string | number | null
}

export interface ReconnectState {
  /** Attempts in a row without the stream making progress in between. */
  attempts: number
  /** Last time the stream made progress (or a fresh wait began); null before it first did. */
  lastProgressAt: number | null
  /** An attempt is scheduled and has not run yet. */
  pending: boolean
  handledErrorKey: string | number | null
  /** The message this policy put up, or null when it shows none. */
  message: string | null
  /** `expectingProgress` of the previous observation. */
  expecting: boolean
}

export const INITIAL_RECONNECT_STATE: ReconnectState = Object.freeze({
  attempts: 0,
  lastProgressAt: null,
  pending: false,
  handledErrorKey: null,
  message: null,
  expecting: false
})

export interface ReconnectStep {
  state: ReconnectState
  /** New message for the viewer; `undefined` leaves whatever is shown alone. */
  message?: string | null
  /** Reconnect after `delayMs`. */
  schedule: { attempt: number; delayMs: number } | null
  /** When to look again if nothing else is observed by then (a stall deadline). */
  recheckAt: number | null
}

function withMessage(state: ReconnectState, message: string | null): Pick<ReconnectStep, 'state' | 'message'> {
  if (state.message === message) return { state }
  return { state: { ...state, message }, message }
}

export function stepReconnect(
  previous: ReconnectState,
  observation: ReconnectObservation,
  now: number
): ReconnectStep {
  let state: ReconnectState = { ...previous, expecting: observation.expectingProgress }

  if (observation.progressing && !observation.error) {
    state = { ...state, attempts: 0, lastProgressAt: now, handledErrorKey: null }
    const cleared = withMessage(state, null)
    return {
      ...cleared,
      schedule: null,
      recheckAt: observation.isLive && observation.expectingProgress ? now + STALL_THRESHOLD_MS + 1 : null
    }
  }

  // Time spent paused by the viewer is not a stall: the clock holds while
  // paused and starts over when playback is asked for again.
  if (state.lastProgressAt !== null && (!observation.expectingProgress || !previous.expecting)) {
    state = { ...state, lastProgressAt: now }
  }

  const freshError =
    observation.error !== null &&
    !(observation.errorKey !== undefined && observation.errorKey !== null && observation.errorKey === state.handledErrorKey)

  if (observation.error !== null && !observation.isLive) {
    return { ...withMessage(state, observation.error), schedule: null, recheckAt: null }
  }

  const stalled =
    observation.isLive &&
    observation.expectingProgress &&
    state.lastProgressAt !== null &&
    now - state.lastProgressAt > STALL_THRESHOLD_MS

  const failing = (observation.isLive && freshError) || stalled
  if (!failing || state.pending) {
    const recheckAt =
      observation.isLive && observation.expectingProgress && state.lastProgressAt !== null && !state.pending
        ? state.lastProgressAt + STALL_THRESHOLD_MS + 1
        : null
    return { state, schedule: null, recheckAt }
  }

  if (state.attempts >= MAX_RECONNECT_ATTEMPTS) {
    // A stall carries no engine error text, and keeping the last "(5/5)"
    // would claim a reconnect is still under way.
    return { ...withMessage(state, observation.error ?? CONNECTION_LOST_MESSAGE), schedule: null, recheckAt: null }
  }

  const attempt = state.attempts + 1
  state = {
    ...state,
    attempts: attempt,
    pending: true,
    handledErrorKey: observation.error !== null ? (observation.errorKey ?? null) : state.handledErrorKey
  }
  return {
    ...withMessage(state, reconnectingMessage(attempt)),
    schedule: { attempt, delayMs: reconnectDelayMs(attempt) },
    recheckAt: null
  }
}

/** The scheduled attempt runs now; the stall clock starts over for the new load. */
export function reconnectAttemptStarted(state: ReconnectState, now: number): ReconnectState {
  return { ...state, pending: false, lastProgressAt: now }
}

export interface ReconnectDriverOptions {
  /** Reload the stream. Called at most once per scheduled attempt. */
  reconnect: (attempt: number) => void
  /** Show (string) or clear (null) the policy's message. */
  showMessage: (message: string | null) => void
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

export interface ReconnectDriver {
  observe(observation: ReconnectObservation): void
  /** Stops every timer; nothing fires after this. */
  dispose(): void
  readonly state: ReconnectState
}

/**
 * Runs the policy for one playback: holds its state, runs the attempt timer
 * and looks again at the stall deadline when no new observation arrives
 * (a stalled stream reports nothing).
 */
export function createReconnectDriver(options: ReconnectDriverOptions): ReconnectDriver {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer))
  let state = INITIAL_RECONNECT_STATE
  let last: ReconnectObservation | null = null
  let attemptTimer: ReturnType<typeof setTimeout> | null = null
  let recheckTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const observe = (observation: ReconnectObservation): void => {
    if (disposed) return
    last = observation
    const at = now()
    const step = stepReconnect(state, observation, at)
    state = step.state
    if (step.message !== undefined) options.showMessage(step.message)

    if (recheckTimer) {
      clearTimer(recheckTimer)
      recheckTimer = null
    }
    if (step.recheckAt !== null) {
      recheckTimer = setTimer(() => {
        recheckTimer = null
        if (last) observe(last)
      }, Math.max(0, step.recheckAt - at))
    }

    if (step.schedule) {
      const { attempt, delayMs } = step.schedule
      attemptTimer = setTimer(() => {
        attemptTimer = null
        if (disposed) return
        state = reconnectAttemptStarted(state, now())
        options.reconnect(attempt)
        if (last) observe(last)
      }, delayMs)
    }
  }

  return {
    observe,
    dispose() {
      disposed = true
      if (attemptTimer) clearTimer(attemptTimer)
      if (recheckTimer) clearTimer(recheckTimer)
      attemptTimer = null
      recheckTimer = null
    },
    get state() {
      return state
    }
  }
}
