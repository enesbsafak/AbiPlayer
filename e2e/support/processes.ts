import { execFile } from 'node:child_process'

export interface ProcessInfo {
  pid: number
  parentPid: number
  name: string
  commandLine: string
}

/** Windows process table through CIM; the only way to see a child's parent pid. */
export function listProcesses(names: string[]): Promise<ProcessInfo[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  const filter = names.map((name) => `Name='${name.replace(/'/g, '')}'`).join(' OR ')
  const script = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20_000 }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve([])
        return
      }
      try {
        const parsed = JSON.parse(stdout) as unknown
        const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>
        resolve(
          rows.map((row) => ({
            pid: Number(row.ProcessId),
            parentPid: Number(row.ParentProcessId),
            name: String(row.Name),
            commandLine: String(row.CommandLine ?? '')
          }))
        )
      } catch {
        resolve([])
      }
    })
  })
}

export const HELPER_BINARIES = ['mpv.exe', 'ffmpeg.exe', 'ffprobe.exe']

/** mpv/ffmpeg/ffprobe processes the given Electron main process started. */
export async function helpersOf(electronPid: number): Promise<ProcessInfo[]> {
  const rows = await listProcesses(HELPER_BINARIES)
  return rows.filter((row) => row.parentPid === electronPid)
}

/**
 * Handle of the process's top-level window, 0 when it has none. mpv embedded
 * through `--wid` renders into a child window of the app and must report 0; a
 * non-zero handle means it opened a window of its own on the desktop.
 */
export function mainWindowHandle(pid: number): Promise<number> {
  if (process.platform !== 'win32') return Promise.resolve(0)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue).MainWindowHandle.ToInt64()`],
      { windowsHide: true, timeout: 20_000 },
      (_error, stdout) => resolve(Number(stdout.trim()) || 0)
    )
  })
}

export function killQuietly(pid: number): void {
  try {
    process.kill(pid)
  } catch {
    // already gone
  }
}
