import { existsSync } from 'node:fs'
import { ensureMedia } from './mock-provider/media.ts'
import { BUILT_MAIN, E2E_CACHE_DIR, E2E_TARGET, FFMPEG_PATH, MPV_PATH, PACKAGED_EXE, electronBinary } from './support/paths.ts'

export default async function globalSetup(): Promise<void> {
  if (E2E_TARGET === 'packaged') {
    if (!existsSync(PACKAGED_EXE)) throw new Error(`${PACKAGED_EXE} is missing. Run "npm run build:unpack".`)
  } else if (!existsSync(BUILT_MAIN)) {
    throw new Error(`${BUILT_MAIN} is missing. Run "npx electron-vite build" (npm run test:e2e does it for you).`)
  }
  // The dev build plays with this mpv; the mock provider's clips are made with this ffmpeg.
  if (E2E_TARGET === 'dev' && !existsSync(MPV_PATH)) {
    throw new Error(`mpv not found at ${MPV_PATH}. Run "npm run prepare:mpv:win" or set MPV_PATH.`)
  }
  if (!existsSync(FFMPEG_PATH)) {
    throw new Error(`ffmpeg not found at ${FFMPEG_PATH}. Run "npm run prepare:ffmpeg:win".`)
  }
  // Electron 42+ downloads its binary on first use instead of at install time;
  // do it here, outside any test's timeout.
  electronBinary()
  // Generating the clips takes ~25 s the first time; later runs reuse the cache.
  await ensureMedia(E2E_CACHE_DIR)
}
