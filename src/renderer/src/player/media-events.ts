export type MediaElementHandlers = Partial<{
  [K in keyof HTMLMediaElementEventMap]: (event: HTMLMediaElementEventMap[K]) => void
}>

/**
 * Attaches `handlers` to the element; the returned function removes every one
 * of them, and aborts the signal handed to them so `{ once: true }` listeners
 * they add (which only remove themselves after firing) go too.
 */
export function wireMediaElementEvents(
  video: HTMLVideoElement,
  createHandlers: (signal: AbortSignal) => MediaElementHandlers
): () => void {
  const controller = new AbortController()
  const handlers = createHandlers(controller.signal)
  for (const [type, handler] of Object.entries(handlers)) {
    if (handler) video.addEventListener(type, handler as EventListener, { signal: controller.signal })
  }
  return () => controller.abort()
}
