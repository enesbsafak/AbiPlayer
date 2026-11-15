import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTION_LOST_MESSAGE,
  INITIAL_RECONNECT_STATE,
  MAX_RECONNECT_ATTEMPTS,
  STALL_THRESHOLD_MS,
  createReconnectDriver,
  reconnectAttemptStarted,
  reconnectDelayMs,
  reconnectingMessage,
  stepReconnect,
  type ReconnectObservation,
  type ReconnectState
} from './reconnect-policy'

const healthy: ReconnectObservation = { isLive: true, progressing: true, expectingProgress: true, error: null }
const stuck: ReconnectObservation = { isLive: true, progressing: false, expectingProgress: true, error: null }
const paused: ReconnectObservation = { isLive: true, progressing: false, expectingProgress: false, error: null }

function afterProgressAt(now: number): ReconnectState {
  return stepReconnect(INITIAL_RECONNECT_STATE, healthy, now).state
}

describe('stepReconnect', () => {
  it('does not call a stream stalled before it ever played', () => {
    const step = stepReconnect(INITIAL_RECONNECT_STATE, stuck, 100_000)
    expect(step.schedule).toBeNull()
    expect(step.recheckAt).toBeNull()
  })

  it('calls a live stream stalled only past the threshold, and says when to look again', () => {
    const state = afterProgressAt(0)
    const early = stepReconnect(state, stuck, STALL_THRESHOLD_MS)
    expect(early.schedule).toBeNull()
    expect(early.recheckAt).toBe(STALL_THRESHOLD_MS + 1)

    const late = stepReconnect(early.state, stuck, STALL_THRESHOLD_MS + 1)
    expect(late.schedule).toEqual({ attempt: 1, delayMs: reconnectDelayMs(1) })
    expect(late.message).toBe(reconnectingMessage(1))
  })

  it('waits longer before each attempt in a row', () => {
    expect([1, 2, 3].map(reconnectDelayMs)).toEqual([1000, 2000, 3000])
  })

  it('does not count time paused by the viewer, nor the moment playback resumes', () => {
    let state = afterProgressAt(0)
    state = stepReconnect(state, paused, 1_000).state
    state = stepReconnect(state, paused, 60_000).state
    const resumed = stepReconnect(state, stuck, 60_001)
    expect(resumed.schedule).toBeNull()
    expect(stepReconnect(resumed.state, stuck, 60_001 + STALL_THRESHOLD_MS + 1).schedule).not.toBeNull()
  })

  it('schedules nothing more while an attempt is pending, and restarts the clock when it runs', () => {
    const scheduled = stepReconnect(afterProgressAt(0), stuck, STALL_THRESHOLD_MS + 1)
    expect(stepReconnect(scheduled.state, stuck, STALL_THRESHOLD_MS * 3).schedule).toBeNull()

    const started = reconnectAttemptStarted(scheduled.state, 20_000)
    expect(stepReconnect(started, stuck, 20_000 + STALL_THRESHOLD_MS).schedule).toBeNull()
    expect(stepReconnect(started, stuck, 20_001 + STALL_THRESHOLD_MS).schedule).toEqual({
      attempt: 2,
      delayMs: 2000
    })
  })

  it('ends on a final message instead of sticking at the last attempt counter', () => {
    let state: ReconnectState = { ...afterProgressAt(0), attempts: MAX_RECONNECT_ATTEMPTS, message: reconnectingMessage(5) }
    const step = stepReconnect(state, stuck, STALL_THRESHOLD_MS + 1)
    expect(step.schedule).toBeNull()
    expect(step.message).toBe(CONNECTION_LOST_MESSAGE)
    state = step.state
    // Coming back by itself clears it.
    expect(stepReconnect(state, healthy, 50_000).message).toBeNull()
  })

  it('reconnects on a live error once per failed load and gives up with the error text', () => {
    const error = { ...stuck, error: 'Bağlantı hatası', errorKey: 7 }
    const first = stepReconnect(INITIAL_RECONNECT_STATE, error, 0)
    expect(first.schedule?.attempt).toBe(1)

    const started = reconnectAttemptStarted(first.state, 1000)
    expect(stepReconnect(started, error, 1001).schedule).toBeNull()
    expect(stepReconnect(started, { ...error, errorKey: 8 }, 1001).schedule?.attempt).toBe(2)

    const exhausted = { ...started, attempts: MAX_RECONNECT_ATTEMPTS }
    expect(stepReconnect(exhausted, { ...error, errorKey: 9 }, 2000).message).toBe('Bağlantı hatası')
  })

  it('shows a film error as it is', () => {
    const step = stepReconnect(INITIAL_RECONNECT_STATE, { ...stuck, isLive: false, error: 'Dosya açılamadı' }, 0)
    expect(step.schedule).toBeNull()
    expect(step.message).toBe('Dosya açılamadı')
  })

  it('never touches a message it did not put up', () => {
    expect(stepReconnect(INITIAL_RECONNECT_STATE, healthy, 0).message).toBeUndefined()
    expect(stepReconnect(afterProgressAt(0), stuck, 10).message).toBeUndefined()
  })

  it('does not reconnect a stalled film', () => {
    const state = stepReconnect(INITIAL_RECONNECT_STATE, { ...healthy, isLive: false }, 0).state
    expect(stepReconnect(state, { ...stuck, isLive: false }, 60_000).schedule).toBeNull()
  })
})

describe('createReconnectDriver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('notices a stall at its deadline without a new observation, then reconnects after the delay', async () => {
    const reconnect = vi.fn()
    const showMessage = vi.fn()
    const driver = createReconnectDriver({ reconnect, showMessage })
    driver.observe(healthy)
    driver.observe(stuck)

    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS + 1)
    expect(showMessage).toHaveBeenLastCalledWith(reconnectingMessage(1))
    expect(reconnect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(reconnect).toHaveBeenCalledWith(1)
  })

  it('fires nothing after dispose', async () => {
    const reconnect = vi.fn()
    const driver = createReconnectDriver({ reconnect, showMessage: vi.fn() })
    driver.observe(healthy)
    driver.observe(stuck)
    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS + 1)
    driver.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reconnect).not.toHaveBeenCalled()
  })

  it('reaches the final message through five attempts of a stream that never comes back', async () => {
    const reconnect = vi.fn()
    const showMessage = vi.fn()
    const driver = createReconnectDriver({ reconnect, showMessage })
    driver.observe(healthy)
    driver.observe(stuck)
    await vi.advanceTimersByTimeAsync(5 * (STALL_THRESHOLD_MS + 1) + 15_000 + STALL_THRESHOLD_MS + 1)
    expect(reconnect).toHaveBeenCalledTimes(MAX_RECONNECT_ATTEMPTS)
    expect(showMessage).toHaveBeenLastCalledWith(CONNECTION_LOST_MESSAGE)
  })
})
