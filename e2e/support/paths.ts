import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** Generated media (gitignored). */
export const E2E_CACHE_DIR = join(REPO_ROOT, 'e2e', '.cache')
/** Screenshots, timelines, Playwright reports (gitignored). */
export const E2E_OUTPUT_DIR = join(REPO_ROOT, 'e2e', '.output')
export const BUILT_MAIN = join(REPO_ROOT, 'out', 'main', 'index.js')
export const MPV_PATH = process.env.MPV_PATH || join(REPO_ROOT, 'resources', 'mpv', 'win32-x64', 'mpv.exe')
/** The pinned FFmpeg build (scripts/ffmpeg-pin.json); the app resolves the same copy in dev. */
export const FFMPEG_DIR = join(REPO_ROOT, 'resources', 'ffmpeg', 'win32-x64')
export const FFMPEG_PATH = join(FFMPEG_DIR, 'ffmpeg.exe')

export function electronBinary(): string {
  return require('electron') as string
}
