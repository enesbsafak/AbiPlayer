import type { ElectronApi } from '../shared/ipc/api'

// Derived from the shared method tables that `build-api.ts` walks to build the
// bridge; add new methods in src/shared/ipc, not here.
declare global {
  interface Window {
    electron?: ElectronApi
  }
}

export {}
