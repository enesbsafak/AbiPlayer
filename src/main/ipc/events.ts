import type { IpcEventChannel, IpcEventPayload } from '../../shared/ipc/contract'

export interface EventTarget {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

/** Typed main → renderer push; the channel and payload come from the shared contract. */
export function sendEvent<C extends IpcEventChannel>(
  target: EventTarget,
  channel: C,
  payload: IpcEventPayload<C>
): void {
  if (target.isDestroyed()) return
  target.send(channel, payload)
}

export function broadcastEvent<C extends IpcEventChannel>(
  targets: Iterable<EventTarget>,
  channel: C,
  payload: IpcEventPayload<C>
): void {
  for (const target of targets) sendEvent(target, channel, payload)
}
