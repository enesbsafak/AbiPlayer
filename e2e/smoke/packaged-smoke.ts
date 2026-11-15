// Packaged smoke test (plan item F0-09). Run after `npm run build:unpack`:
//
//   npm run test:e2e:packaged                 checks dist/win-unpacked
//   node e2e/smoke/packaged-smoke.ts <dir>    checks another unpacked build
//
// 1. mpv, ffmpeg and ffprobe exist where the packaged app resolves them
//    (mpv-controller.ts resolveBundledMpvPath; ipc-handlers.ts via
//    resolveUnpackedBinary) and each starts and prints its version.
// 2. Nothing from the worktrees, e2e/, docs/, scripts/, src/ or test output
//    is inside the package.
// 3. Prints the package size.
// The app itself is not launched.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { REPO_ROOT } from '../support/paths.ts'

const root = process.argv[2] ?? join(REPO_ROOT, 'dist', 'win-unpacked')
const resources = join(root, 'resources')
const failures: string[] = []
const lines: string[] = []

function check(ok: boolean, message: string) {
  lines.push(`${ok ? 'ok  ' : 'FAIL'} ${message}`)
  if (!ok) failures.push(message)
}

function sizeOf(path: string): number {
  const stat = statSync(path)
  if (!stat.isDirectory()) return stat.size
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0)
}

function walk(path: string, out: string[] = []): string[] {
  for (const name of readdirSync(path)) {
    const full = join(path, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** File list of an asar archive, read straight from its JSON header. */
function asarFiles(archive: string): string[] {
  const buffer = readFileSync(archive)
  const jsonLength = buffer.readUInt32LE(12)
  const header = JSON.parse(buffer.subarray(16, 16 + jsonLength).toString('utf8')) as AsarNode
  const files: string[] = []
  const visit = (node: AsarNode, prefix: string) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name
      if (child.files) visit(child, path)
      else files.push(path)
    }
  }
  visit(header, '')
  return files
}
interface AsarNode { files?: Record<string, AsarNode> }

function version(binary: string, args: string[]): string | null {
  try {
    const output = execFileSync(binary, args, { windowsHide: true, timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] })
    return output.toString().split(/\r?\n/).find((line) => line.trim()) ?? ''
  } catch (error) {
    const stdout = (error as { stdout?: Buffer }).stdout?.toString() ?? ''
    return stdout.trim() ? stdout.split(/\r?\n/)[0] : null
  }
}

check(existsSync(join(root, 'abi-player.exe')), `executable ${relative(REPO_ROOT, join(root, 'abi-player.exe'))}`)
const archive = join(resources, 'app.asar')
check(existsSync(archive), 'resources/app.asar')

// Where the packaged app looks for each binary.
const binaries = [
  { name: 'mpv', path: join(resources, 'mpv', 'mpv.exe'), args: ['--version'], expect: /^mpv /i },
  { name: 'ffmpeg', path: join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'), args: ['-hide_banner', '-version'], expect: /^ffmpeg version/i },
  { name: 'ffprobe', path: join(resources, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe'), args: ['-hide_banner', '-version'], expect: /^ffprobe version/i }
]
for (const binary of binaries) {
  const present = existsSync(binary.path)
  check(present, `${binary.name} at ${relative(root, binary.path)}`)
  if (!present) continue
  const first = version(binary.path, binary.args)
  check(!!first && binary.expect.test(first), `${binary.name} starts and prints its version: ${first ?? 'no output'}`)
}

// Nothing that is not runtime code.
const FORBIDDEN = [/^\.worktrees\//, /^e2e\//, /^docs\//, /^scripts\//, /^src\//, /^test-results\//, /^playwright-report\//, /^coverage\//, /^dist\//, /\.tsbuildinfo$/, /\.test\.[cm]?[jt]sx?$/, /^\.github\//]
const packaged = existsSync(archive) ? asarFiles(archive) : []
const unpackedDir = join(resources, 'app.asar.unpacked')
const unpacked = existsSync(unpackedDir) ? walk(unpackedDir).map((file) => relative(unpackedDir, file).split(sep).join('/')) : []
const offending = [...packaged, ...unpacked].filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)))
check(offending.length === 0, `no repository-only files in the package${offending.length ? `: ${offending.slice(0, 10).join(', ')}${offending.length > 10 ? ` (+${offending.length - 10})` : ''}` : ''}`)
const topLevel = [...new Set(packaged.map((file) => file.split('/')[0]))].sort()

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
console.log(lines.join('\n'))
console.log(`\napp.asar top level: ${topLevel.join(', ')}`)
console.log(`package size: ${mb(sizeOf(root))} total; app.asar ${existsSync(archive) ? mb(statSync(archive).size) : '–'}; app.asar.unpacked ${existsSync(unpackedDir) ? mb(sizeOf(unpackedDir)) : '–'}; resources/mpv ${existsSync(join(resources, 'mpv')) ? mb(sizeOf(join(resources, 'mpv'))) : '–'}`)
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
