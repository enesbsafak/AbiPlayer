// Catalog cache measurement (work package C2c): cold launches (no catalog on
// disk) against warm launches (catalog cached in IndexedDB), at 50,000 and
// 200,000 items, on a local and on a throttled link. Also reports the main
// thread's long tasks while the catalog is ingested, the renderer heap once
// the catalog is in, and the size of the IndexedDB directory.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON e2e/perf/catalog-cache.ts --label once
//   node ... e2e/perf/catalog-cache.ts --sizes medium --links local --runs 2
//
// Build first (`npx electron-vite build`). The app runs in the e2e test mode
// (ABI_E2E=1): off-screen, never focused, muted. Raw timelines go to
// e2e/.output/perf-cache/<label>/; the summary is written as JSON there and
// printed, so a report can be put together from two labels (before / after).
//
// Works against builds without the cache too: there, every launch is cold.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { CATALOG_PRESETS, type CatalogPreset } from '../mock-provider/catalog.ts'
import { ensureMedia } from '../mock-provider/media.ts'
import { startMockProvider } from '../mock-provider/server.ts'
import { launchApp, newProfileDir, removeProfileDir, type AbiApp } from '../support/app.ts'
import { addXtreamSource, expectHomeWithContent } from '../support/flows.ts'
import { E2E_CACHE_DIR, E2E_OUTPUT_DIR, REPO_ROOT } from '../support/paths.ts'
import type { MergedPerfMark, MergedPerfTimeline } from '../../src/shared/perf.ts'
import { fmt, median, range } from './stats.ts'

const { values: args } = parseArgs({
  options: {
    sizes: { type: 'string', default: 'medium,large' },
    links: { type: 'string', default: 'local,throttled' },
    runs: { type: 'string', default: '3' },
    label: { type: 'string', default: 'run' }
  }
})

const SIZES = args.sizes!.split(',').map((size) => size.trim()) as CatalogPreset[]
const LINKS = args.links!.split(',').map((link) => link.trim())
const RUNS = Number(args.runs)
const OUT_DIR = join(E2E_OUTPUT_DIR, 'perf-cache', args.label!)
const SETTLE_TIMEOUT_MS = 300_000

interface LinkProfile {
  key: string
  name: string
  latencyMs: number
  bandwidthBytesPerSec: number | null
}

const LINK_PROFILES: Record<string, LinkProfile> = {
  local: { key: 'local', name: 'yerel', latencyMs: 0, bandwidthBytesPerSec: null },
  throttled: { key: 'throttled', name: 'kısıtlı (150 ms, 2 MB/s)', latencyMs: 150, bandwidthBytesPerSec: 2 * 1024 * 1024 }
}

mkdirSync(OUT_DIR, { recursive: true })
const media = await ensureMedia(E2E_CACHE_DIR)

function log(message: string) {
  console.log(`[perf-cache ${new Date().toISOString().slice(11, 19)}] ${message}`)
}

const TYPES = ['live', 'vod', 'series'] as const

function marks(timeline: MergedPerfTimeline, name: string): MergedPerfMark[] {
  return timeline.marks.filter((mark) => mark.name === name)
}

function firstMark(timeline: MergedPerfTimeline, name: string): number | null {
  return marks(timeline, name)[0]?.t ?? null
}

/** The network sync of every type ended (done or failed). */
function syncSettled(timeline: MergedPerfTimeline): boolean {
  const settled = new Set(
    timeline.marks.filter((mark) => mark.name === 'sync:done' || mark.name === 'sync:failed').map((mark) => String(mark.detail?.type))
  )
  return TYPES.every((type) => settled.has(type))
}

/** When each type first held a complete list: from the cache or from the network, whichever came first. */
function completeAt(timeline: MergedPerfTimeline): number | null {
  const times = TYPES.map((type) => {
    const candidates = timeline.marks
      .filter((mark) => (mark.name === 'sync:done' || mark.name === 'cache:committed') && mark.detail?.type === type)
      .map((mark) => mark.t)
    return candidates.length ? Math.min(...candidates) : null
  })
  return times.every((time) => time !== null) ? Math.max(...(times as number[])) : null
}

function freshAt(timeline: MergedPerfTimeline): number | null {
  const times = TYPES.map((type) => marks(timeline, 'sync:done').find((mark) => mark.detail?.type === type)?.t ?? null)
  return times.every((time) => time !== null) ? Math.max(...(times as number[])) : null
}

async function waitForTimeline(app: AbiApp, ready: (timeline: MergedPerfTimeline) => boolean, timeoutMs: number): Promise<MergedPerfTimeline> {
  const deadline = Date.now() + timeoutMs
  let timeline = await app.perf()
  while (!ready(timeline) && Date.now() < deadline) {
    await app.page.waitForTimeout(500)
    timeline = await app.perf()
  }
  return timeline
}

/** Renderer heap after a full garbage collection, through the DevTools protocol. */
async function heapUsedMb(app: AbiApp): Promise<number | null> {
  try {
    const session = await app.page.context().newCDPSession(app.page)
    await session.send('HeapProfiler.collectGarbage')
    const usage = (await session.send('Runtime.getHeapUsage')) as { usedSize: number }
    await session.detach()
    return usage.usedSize / (1024 * 1024)
  } catch {
    return null
  }
}

function directorySize(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    total += entry.isDirectory() ? directorySize(path) : statSync(path).size
  }
  return total
}

interface Run {
  size: CatalogPreset
  link: string
  mode: 'cold' | 'warm'
  homeContent: number | null
  complete: number | null
  fresh: number | null
  syncFailed: boolean
  longTaskCount: number
  longTaskTotal: number
  longTaskMax: number
  heapMb: number | null
  idbBytes: number
}

async function measure(profile: string, size: CatalogPreset, link: LinkProfile, mode: 'cold' | 'warm', run: number): Promise<Run> {
  if (mode === 'cold') rmSync(join(profile, 'IndexedDB'), { recursive: true, force: true })
  const label = `${size}-${link.key}-${mode}-${run}`
  const app = await launchApp({ profileDir: profile, outputDir: join(OUT_DIR, 'shots'), label })
  try {
    await expectHomeWithContent(app.page, 120_000)
    const timeline = await waitForTimeline(
      app,
      (current) => syncSettled(current) && !!firstMark(current, 'renderer:home-first-content'),
      SETTLE_TIMEOUT_MS
    )
    writeFileSync(join(OUT_DIR, `${label}.json`), JSON.stringify(timeline, null, 2))
    // Ingest window: from the first catalog work (cache read or sync) to the
    // last complete list; long tasks of the renderer's main thread inside it.
    const starts = timeline.marks.filter((mark) => mark.name === 'sync:start' || mark.name === 'cache:read-start').map((mark) => mark.t)
    const ends = timeline.marks
      .filter((mark) => mark.name === 'sync:done' || mark.name === 'sync:failed' || mark.name === 'cache:committed')
      .map((mark) => mark.t)
    const windowStart = starts.length ? Math.min(...starts) : 0
    const windowEnd = ends.length ? Math.max(...ends) + 500 : Infinity
    const longTasks = timeline.longTasks.filter(
      (task) => task.process === 'renderer' && task.start + task.duration >= windowStart && task.start <= windowEnd
    )
    const heapMb = await heapUsedMb(app)
    return {
      size,
      link: link.name,
      mode,
      homeContent: firstMark(timeline, 'renderer:home-first-content'),
      complete: completeAt(timeline),
      fresh: freshAt(timeline),
      syncFailed: marks(timeline, 'sync:failed').length > 0,
      longTaskCount: longTasks.length,
      longTaskTotal: longTasks.reduce((sum, task) => sum + task.duration, 0),
      longTaskMax: longTasks.reduce((max, task) => Math.max(max, task.duration), 0),
      heapMb,
      idbBytes: 0
    }
  } finally {
    const report = await app.close()
    if (report.strays.length > 0) log(`stray helpers killed: ${report.strays.map((stray) => stray.name).join(', ')}`)
  }
}

async function scenario(size: CatalogPreset, link: LinkProfile): Promise<Run[]> {
  const mock = await startMockProvider({ media, size, latencyMs: 0 })
  const profile = newProfileDir()
  const results: Run[] = []
  try {
    log(`${size}/${link.key}: setup`)
    const setup = await launchApp({ profileDir: profile, outputDir: join(OUT_DIR, 'shots'), label: `setup-${size}-${link.key}` })
    try {
      await addXtreamSource(setup.page, mock)
      await expectHomeWithContent(setup.page, 120_000)
      await waitForTimeline(setup, syncSettled, SETTLE_TIMEOUT_MS)
      // Let the cache write (if any) finish before the app goes.
      await setup.page.waitForTimeout(3000)
    } finally {
      await setup.close()
    }
    mock.update({ latencyMs: link.latencyMs, bandwidthBytesPerSec: link.bandwidthBytesPerSec })

    for (let run = 1; run <= RUNS; run += 1) {
      for (const mode of ['cold', 'warm'] as const) {
        log(`${size}/${link.key}: ${mode} ${run}/${RUNS}`)
        const result = await measure(profile, size, link, mode, run)
        // The cache the launch left behind (written after a cold start, refreshed after a warm one).
        await new Promise((resolve) => setTimeout(resolve, 500))
        result.idbBytes = directorySize(join(profile, 'IndexedDB'))
        results.push(result)
        log(
          `  home ${fmt(result.homeContent)} ms, complete ${fmt(result.complete)} ms, fresh ${fmt(result.fresh)} ms, ` +
            `long tasks ${result.longTaskCount}/${fmt(result.longTaskTotal)} ms/max ${fmt(result.longTaskMax)} ms, heap ${fmt(result.heapMb)} MB, idb ${fmt(result.idbBytes / 1024 / 1024)} MB`
        )
      }
    }
  } finally {
    await mock.close()
    removeProfileDir(profile)
  }
  return results
}

function table(results: Run[]): string[] {
  const groups = new Map<string, Run[]>()
  for (const result of results) {
    const key = `${result.size}|${result.link}|${result.mode}`
    groups.set(key, [...(groups.get(key) ?? []), result])
  }
  const lines = [
    '| Katalog | Bağlantı | Açılış | n | Ana sayfada ilk içerik | Tam katalog bellekte | Sağlayıcıdan taze liste | Uzun görev (adet / toplam / en uzun) | Yığın (GC sonrası) | IndexedDB |',
    '|---|---|---|---|---|---|---|---|---|---|'
  ]
  for (const [key, group] of groups) {
    const [size, link, mode] = key.split('|')
    const total = CATALOG_PRESETS[size as CatalogPreset]
    const values = (fn: (run: Run) => number | null) => group.map(fn).filter((value): value is number => value !== null)
    const cell = (fn: (run: Run) => number | null, unit = ' ms') => {
      const list = values(fn)
      return list.length ? `${fmt(median(list), unit)} (${range(list)})` : '–'
    }
    lines.push(
      `| ${size} (${(total.live + total.vod + total.series).toLocaleString('tr-TR')}) | ${link} | ${mode === 'cold' ? 'soğuk' : 'sıcak'} | ${group.length} | ` +
        `${cell((run) => run.homeContent)} | ${cell((run) => run.complete)} | ${cell((run) => run.fresh)}${group.some((run) => run.syncFailed) ? ' (hata var)' : ''} | ` +
        `${fmt(median(values((run) => run.longTaskCount)))} / ${fmt(median(values((run) => run.longTaskTotal)), ' ms')} / ${fmt(median(values((run) => run.longTaskMax)), ' ms')} | ` +
        `${cell((run) => run.heapMb, ' MB')} | ${fmt(median(values((run) => run.idbBytes / 1024 / 1024)), ' MB')} |`
    )
  }
  return lines
}

let commit = '?'
try {
  commit = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim()
} catch {
  // ignore
}

const all: Run[] = []
for (const size of SIZES) {
  for (const linkKey of LINKS) {
    const link = LINK_PROFILES[linkKey]
    if (!link) throw new Error(`unknown link "${linkKey}"; known: ${Object.keys(LINK_PROFILES).join(', ')}`)
    all.push(...(await scenario(size, link)))
  }
}
writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify({ commit, runs: all }, null, 2))
const lines = [`Kod: ${commit}, etiket: ${args.label}`, '', ...table(all)]
writeFileSync(join(OUT_DIR, 'table.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
