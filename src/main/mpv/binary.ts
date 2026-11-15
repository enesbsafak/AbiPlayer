import { posix, win32 } from 'path'

export interface MpvBinaryEnvironment {
  platform: NodeJS.Platform
  /** `app.isPackaged`: false for `electron-vite dev` and the test harness. */
  isPackaged: boolean
  /** `process.env.MPV_PATH` */
  mpvPathOverride?: string
  /** `process.env.PATH` */
  searchPath?: string
  /** `process.resourcesPath`; undefined outside Electron. */
  resourcesPath?: string
  /** Directory of the main-process bundle (`out/main` in dev). */
  appDir: string
  cwd: string
  exists: (candidate: string) => boolean
}

// macOS and Linux packages do not bundle mpv; these are the absolute paths the
// usual package managers install to. A packaged build never resolves a bare
// `mpv` through PATH.
const SYSTEM_MPV_LOCATIONS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: [
    '/opt/homebrew/bin/mpv',
    '/usr/local/bin/mpv',
    '/opt/local/bin/mpv',
    '/Applications/mpv.app/Contents/MacOS/mpv'
  ],
  linux: ['/usr/bin/mpv', '/usr/local/bin/mpv', '/snap/bin/mpv']
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

function searchOnPath(env: MpvBinaryEnvironment, name: string): string | null {
  if (!env.searchPath) return null
  const api = pathApi(env.platform)
  const names =
    env.platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? [name, `${name}.exe`] : [name]
  for (const dir of env.searchPath.split(env.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue
    for (const candidateName of names) {
      const candidate = api.join(dir, candidateName)
      if (env.exists(candidate)) return candidate
    }
  }
  return null
}

function shippedCandidates(env: MpvBinaryEnvironment): string[] {
  if (!env.resourcesPath) return []
  const api = pathApi(env.platform)
  if (env.platform !== 'win32') return [api.join(env.resourcesPath, 'mpv', 'mpv')]
  return [
    // electron-builder copies resources/mpv/win32-x64 to <resources>/mpv.
    api.join(env.resourcesPath, 'mpv', 'mpv.exe'),
    api.join(env.resourcesPath, 'resources', 'mpv', 'win32-x64', 'mpv.exe'),
    api.join(env.resourcesPath, 'app.asar.unpacked', 'resources', 'mpv', 'win32-x64', 'mpv.exe')
  ]
}

/**
 * Locates the mpv executable as an absolute path, or null when there is none.
 *
 * Packaged builds only accept the copy shipped inside the install directory,
 * and where nothing is shipped, fixed system locations: an environment
 * variable, the working directory or PATH could point a packaged app at any
 * executable. Development builds (`app.isPackaged === false`) also honour
 * `MPV_PATH`, the repository checkout and PATH.
 */
export function resolveMpvBinary(env: MpvBinaryEnvironment): string | null {
  const api = pathApi(env.platform)
  const firstExisting = (candidates: string[]): string | null =>
    candidates.find((candidate) => env.exists(candidate)) ?? null
  const systemLocations = SYSTEM_MPV_LOCATIONS[env.platform] ?? []

  if (env.isPackaged) {
    return firstExisting(shippedCandidates(env)) ?? firstExisting(systemLocations)
  }

  const override = env.mpvPathOverride?.trim()
  if (override) {
    const isPath = override.includes('/') || override.includes('\\')
    if (isPath) return env.exists(override) ? override : null
    return searchOnPath(env, override)
  }

  const checkout =
    env.platform === 'win32'
      ? [
          api.join(env.appDir, '..', '..', 'resources', 'mpv', 'win32-x64', 'mpv.exe'),
          api.join(env.cwd, 'resources', 'mpv', 'win32-x64', 'mpv.exe')
        ]
      : []

  return (
    firstExisting([...shippedCandidates(env), ...checkout]) ??
    searchOnPath(env, 'mpv') ??
    firstExisting(systemLocations)
  )
}
