import { existsSync } from 'node:fs'
import { ensureMedia } from './mock-provider/media.ts'
import { BUILT_MAIN, E2E_CACHE_DIR, MPV_PATH } from './support/paths.ts'

export default async function globalSetup(): Promise<void> {
  if (!existsSync(BUILT_MAIN)) {
    throw new Error(`${BUILT_MAIN} is missing. Run "npx electron-vite build" (npm run test:e2e does it for you).`)
  }
  if (!existsSync(MPV_PATH)) {
    throw new Error(`mpv not found at ${MPV_PATH}. Run "npm run prepare:mpv:win" or set MPV_PATH.`)
  }
  // Generating the clips takes ~25 s the first time; later runs reuse the cache.
  await ensureMedia(E2E_CACHE_DIR)
}
