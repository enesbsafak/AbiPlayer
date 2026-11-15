import { win32 } from 'path'

export interface MediaToolEnvironment {
  platform: NodeJS.Platform
  /** `app.isPackaged`: false for `electron-vite dev` and the test harness. */
  isPackaged: boolean
  /** `process.resourcesPath`; undefined outside Electron. */
  resourcesPath?: string
  /** Directory of the main-process bundle (`out/main` in dev). */
  appDir: string
  cwd: string
  exists: (candidate: string) => boolean
}

export interface MediaToolPaths {
  ffmpeg: string | null
  ffprobe: string | null
}

/** Where `npm run prepare:ffmpeg:win` installs the pinned build in a checkout. */
const CHECKOUT_DIR = ['resources', 'ffmpeg', 'win32-x64']

function candidates(env: MediaToolEnvironment, executable: string): string[] {
  // electron-builder copies resources/ffmpeg/win32-x64 to <resources>/ffmpeg.
  const shipped = env.resourcesPath ? [win32.join(env.resourcesPath, 'ffmpeg', executable)] : []
  if (env.isPackaged) return shipped
  return [
    win32.join(env.appDir, '..', '..', ...CHECKOUT_DIR, executable),
    win32.join(env.cwd, ...CHECKOUT_DIR, executable)
  ]
}

/**
 * Locates the pinned ffmpeg and ffprobe (scripts/ffmpeg-pin.json) as absolute
 * paths, or null when they are not there.
 *
 * Packaged builds only accept the copy shipped next to the app; nothing from
 * the environment, the working directory or PATH can redirect them. Development
 * builds use the copy the prepare script installed in the checkout. Only
 * Windows ships these binaries.
 */
export function resolveMediaTools(env: MediaToolEnvironment): MediaToolPaths {
  if (env.platform !== 'win32') return { ffmpeg: null, ffprobe: null }
  const find = (executable: string): string | null =>
    candidates(env, executable).find((candidate) => env.exists(candidate)) ?? null
  return { ffmpeg: find('ffmpeg.exe'), ffprobe: find('ffprobe.exe') }
}
