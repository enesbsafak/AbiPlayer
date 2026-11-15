// Launches the built app (out/, or the unpacked package with
// ABI_E2E_TARGET=packaged) under Playwright's Electron support with a
// throwaway profile, the pinned mpv and timing marks switched on.

import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { mergeTimelines, type MergedPerfTimeline, type PerfTimeline } from '../../src/shared/perf.ts'
import type { MpvStateSnapshot } from '../../src/shared/types/electron-ipc.ts'
import { BUILT_MAIN, E2E_TARGET, MPV_PATH, PACKAGED_DIR, PACKAGED_EXE, REPO_ROOT, electronBinary } from './paths.ts'
import { helpersOf, killQuietly, type ProcessInfo } from './processes.ts'

export interface LaunchOptions {
  profileDir: string
  env?: Record<string, string>
  /** Directory for screenshots and logs of this launch. */
  outputDir: string
  label?: string
}

export interface CloseReport {
  /** Helper processes still alive after the app exited; they were killed. */
  strays: ProcessInfo[]
  exitedCleanly: boolean
}

export interface WindowPlacement {
  bounds: { x: number; y: number; width: number; height: number }
  onAnyDisplay: boolean
  focused: boolean
  visible: boolean
}

export interface AbiApp {
  label: string
  /** Where the app window is, to prove test mode kept it off the desktop. */
  windowPlacement(): Promise<WindowPlacement>
  electron: ElectronApplication
  page: Page
  pid: number
  launchedAt: number
  /** Console output of both processes, for diagnosis and observations. */
  logs: string[]
  shot(name: string): Promise<string>
  mpvState(): Promise<MpvStateSnapshot>
  perf(): Promise<MergedPerfTimeline>
  close(): Promise<CloseReport>
}

export function newProfileDir(): string {
  return mkdtempSync(join(tmpdir(), 'abi-e2e-profile-'))
}

export function removeProfileDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // Chromium may still hold a lock file for a moment; the OS temp cleaner gets it.
  }
}

/**
 * A fresh profile starts muted at volume 0. The renderer store falls back to
 * `store-backup.json` in userData when localStorage is empty (the updater's
 * backup path), so writing it pre-seeds the persisted state before the first
 * paint. Profiles that already ran keep their own (already muted) state.
 */
function seedSilentProfile(profileDir: string): void {
  if (existsSync(join(profileDir, 'Local Storage'))) return
  writeFileSync(
    join(profileDir, 'store-backup.json'),
    JSON.stringify({ state: { volume: 0, isMuted: true }, version: 0 })
  )
}

export async function launchApp(options: LaunchOptions): Promise<AbiApp> {
  const packaged = E2E_TARGET === 'packaged'
  if (packaged && !existsSync(PACKAGED_EXE)) {
    throw new Error(`${PACKAGED_EXE} is missing; run "npm run build:unpack" first.`)
  }
  if (!packaged && !existsSync(BUILT_MAIN)) {
    throw new Error(`${BUILT_MAIN} is missing; run "npx electron-vite build" first (npm run test:e2e does).`)
  }
  mkdirSync(options.outputDir, { recursive: true })

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  // Never inherit a dev-server URL or node mode from the surrounding shell.
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  // ABI_E2E: off-screen, never-activated window (src/main/e2e-mode.ts). A
  // packaged app ignores MPV_PATH and uses the mpv it ships.
  Object.assign(env, packaged ? {} : { MPV_PATH }, { ABI_PERF: '1', ABI_E2E: '1' }, options.env ?? {})
  seedSilentProfile(options.profileDir)

  const launchedAt = Date.now()
  const electron = await _electron.launch({
    executablePath: packaged ? PACKAGED_EXE : electronBinary(),
    args: packaged ? [`--user-data-dir=${options.profileDir}`] : [REPO_ROOT, `--user-data-dir=${options.profileDir}`],
    cwd: packaged ? PACKAGED_DIR : REPO_ROOT,
    env,
    timeout: 60_000
  })
  const logs: string[] = []
  const child = electron.process()
  child.stdout?.on('data', (chunk: Buffer) => logs.push(`[main] ${chunk.toString().trimEnd()}`))
  child.stderr?.on('data', (chunk: Buffer) => logs.push(`[main:err] ${chunk.toString().trimEnd()}`))

  const page = await electron.firstWindow()
  page.on('console', (message) => logs.push(`[renderer:${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => logs.push(`[renderer:pageerror] ${error.message}`))

  // Playwright's spawned process is a launcher; mpv's parent is the real main
  // process, so ask it for its own pid.
  const pid = await electron.evaluate(() => process.pid)
  const launcherPid = child.pid ?? -1
  const label = options.label ?? 'app'
  let shotIndex = 0

  const app: AbiApp = {
    label,
    electron,
    page,
    pid,
    launchedAt,
    logs,
    async shot(name) {
      shotIndex += 1
      const file = join(options.outputDir, `${label}-${String(shotIndex).padStart(2, '0')}-${name}.png`)
      await page.screenshot({ path: file }).catch(() => undefined)
      return file
    },
    mpvState() {
      return page.evaluate(() => window.electron!.mpvGetState())
    },
    windowPlacement() {
      return electron.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0]
        const bounds = window.getBounds()
        const onAnyDisplay = screen.getAllDisplays().some(({ bounds: display }) =>
          bounds.x < display.x + display.width &&
          bounds.x + bounds.width > display.x &&
          bounds.y < display.y + display.height &&
          bounds.y + bounds.height > display.y
        )
        return { bounds, onAnyDisplay, focused: window.isFocused(), visible: window.isVisible() }
      })
    },
    async perf() {
      const main = await electron.evaluate(() => {
        const perf = (globalThis as Record<string, unknown>).__abiPerf as { timeline(): unknown } | undefined
        return perf ? perf.timeline() : null
      })
      const renderer = await page.evaluate(() => {
        const perf = (window as unknown as Record<string, unknown>).__abiPerf as { timeline(): unknown } | undefined
        return perf ? perf.timeline() : null
      })
      return mergeTimelines([main, renderer].filter(Boolean) as PerfTimeline[])
    },
    async close() {
      writeFileSync(join(options.outputDir, `${label}-console.log`), logs.join('\n'))
      let exitedCleanly = true
      try {
        await Promise.race([
          electron.close(),
          delay(20_000).then(() => {
            throw new Error('close timed out')
          })
        ])
      } catch {
        exitedCleanly = false
        killQuietly(pid)
        killQuietly(launcherPid)
      }
      // Give helpers a moment to follow their parent out before calling them strays.
      await delay(1500)
      const strays = await helpersOf(pid)
      for (const stray of strays) killQuietly(stray.pid)
      return { strays, exitedCleanly }
    }
  }
  return app
}
