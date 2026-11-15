import { IdbCacheBackend } from '@/catalog/cache/backend'
import { createWorkerRuntime } from './runtime'
import type { MainToWorker, WorkerToMain } from './protocol'

// Entry of the catalog worker: fetching, parsing, normalizing and the
// IndexedDB cache run here, off the renderer's main thread (see runtime.ts).

/** The parts of DedicatedWorkerGlobalScope used here (the renderer is typed with the DOM library). */
interface WorkerScope {
  postMessage(message: WorkerToMain): void
  onmessage: ((event: MessageEvent<MainToWorker>) => void) | null
}

const scope = self as unknown as WorkerScope

const runtime = createWorkerRuntime({
  post: (message: WorkerToMain) => scope.postMessage(message),
  openBackend: () => (typeof indexedDB === 'undefined' ? Promise.resolve(null) : IdbCacheBackend.open())
})

scope.onmessage = (event: MessageEvent<MainToWorker>) => runtime.handle(event.data)
