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

/**
 * Which build the suite drives: `dev` (out/ under the repository's Electron,
 * the default) or `packaged` (`ABI_E2E_TARGET=packaged`, the unpacked package
 * `npm run build:unpack` makes; e2e/playwright.packaged.config.ts sets it).
 */
export const E2E_TARGET: 'dev' | 'packaged' = process.env.ABI_E2E_TARGET === 'packaged' ? 'packaged' : 'dev'
/** The unpacked package; `ABI_E2E_PACKAGED_DIR` points at another one. */
export const PACKAGED_DIR = process.env.ABI_E2E_PACKAGED_DIR || join(REPO_ROOT, 'dist', 'win-unpacked')
export const PACKAGED_EXE = join(PACKAGED_DIR, 'abi-player.exe')
/** Where the build under test finds mpv, ffmpeg and ffprobe. */
export const TARGET_BINARY_DIRS =
  E2E_TARGET === 'packaged'
    ? { mpv: join(PACKAGED_DIR, 'resources', 'mpv'), ffmpeg: join(PACKAGED_DIR, 'resources', 'ffmpeg') }
    : { mpv: dirname(MPV_PATH), ffmpeg: FFMPEG_DIR }

export function electronBinary(): string {
  return require('electron') as string
}
