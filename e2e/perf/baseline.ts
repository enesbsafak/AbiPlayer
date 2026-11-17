// Baseline measurement (plan items F0-07, F2-01): startup and playback opening
// of the built app against the mock provider, several runs each, written as a
// Markdown report with medians to docs/olcumler/.
//
//   npm run perf:baseline                      all sizes, default run counts
//   node e2e/perf/baseline.ts --sizes small --startup-runs 2 --playback-runs 2
//   node e2e/perf/baseline.ts --only playback --playback-runs 6 --out <file> --label <name>
//
// `--only playback` skips the startup runs, `--no-throttled` the slow-link
// playback runs; `--label` names the run in the report and in the raw summary
// file (summary-<label>.json), so several variants can be compared.
//
// The app runs in the e2e test mode (ABI_E2E=1): off-screen, never focused,
// muted, silent clips. Raw timelines go to e2e/.output/perf/.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, totalmem, release } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import { CATALOG_PRESETS, KNOWN, type CatalogPreset } from '../mock-provider/catalog.ts'
import { ensureMedia } from '../mock-provider/media.ts'
import { startMockProvider } from '../mock-provider/server.ts'
import { launchApp, newProfileDir, removeProfileDir, type AbiApp } from '../support/app.ts'
import { addM3uSource, addXtreamSource, cardButton, closeMiniPlayer, expectHomeWithContent, leavePlayer, openRoute, revealPlayerControls, timeToMpvProgress } from '../support/flows.ts'
import { helpersOf } from '../support/processes.ts'
import { E2E_CACHE_DIR, E2E_OUTPUT_DIR, MPV_PATH, REPO_ROOT } from '../support/paths.ts'
import type { MergedPerfMark, MergedPerfTimeline } from '../../src/shared/perf.ts'
import { fmt, median, range } from './stats.ts'

const { values: args } = parseArgs({
  options: {
    sizes: { type: 'string', default: 'small,medium,large' },
    'startup-runs': { type: 'string', default: '3' },
    'playback-runs': { type: 'string', default: '5' },
    only: { type: 'string', default: 'all' },
    'no-throttled': { type: 'boolean', default: false },
    // The cold click waits for the pre-warmed idle mpv (main's prewarm, 1.5 s
    // after the window is up) instead of racing it.
    'wait-prewarm': { type: 'boolean', default: false },
    label: { type: 'string' },
    out: { type: 'string' }
  }
})

const ONLY = args.only as 'all' | 'startup' | 'playback'
if (!['all', 'startup', 'playback'].includes(ONLY)) throw new Error(`--only must be all, startup or playback, not ${ONLY}`)
const LABEL = args.label?.replace(/[^\w.-]/g, '_') ?? null

const SIZES = args.sizes!.split(',').map((size) => size.trim()) as CatalogPreset[]
const STARTUP_RUNS = Number(args['startup-runs'])
const PLAYBACK_RUNS = Number(args['playback-runs'])
const RAW_DIR = join(E2E_OUTPUT_DIR, 'perf')
const FULL_CATALOG_TIMEOUT_MS = 240_000

/** A slow home connection: per-request latency and a per-connection cap. */
const THROTTLED = { latencyMs: 150, bandwidthBytesPerSec: 2 * 1024 * 1024 }

interface LinkProfile {
  name: string
  latencyMs: number
  bandwidthBytesPerSec: number | null
}
const LOCAL: LinkProfile = { name: 'yerel', latencyMs: 0, bandwidthBytesPerSec: null }
const SLOW: LinkProfile = { name: 'kısıtlı (150 ms, 2 MB/s)', ...THROTTLED }

mkdirSync(RAW_DIR, { recursive: true })
const media = await ensureMedia(E2E_CACHE_DIR)

function log(message: string) {
  console.log(`[perf ${new Date().toISOString().slice(11, 19)}] ${message}`)
}

function mark(timeline: MergedPerfTimeline, name: string, after = -Infinity, predicate?: (mark: MergedPerfMark) => boolean): MergedPerfMark | null {
  return timeline.marks.find((item) => item.name === name && item.t >= after && (!predicate || predicate(item))) ?? null
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

function syncSettled(timeline: MergedPerfTimeline): boolean {
  const settled = new Set(
    timeline.marks.filter((item) => item.name === 'sync:done' || item.name === 'sync:failed').map((item) => String(item.detail?.type))
  )
  return ['live', 'vod', 'series'].every((type) => settled.has(type))
}

/** Sync done and the window painted: with a small catalog the data can land before the first paint. */
function startupSettled(timeline: MergedPerfTimeline): boolean {
  return syncSettled(timeline) && !!mark(timeline, 'renderer:first-contentful-paint') && !!mark(timeline, 'main:ready-to-show')
}

async function launch(profileDir: string, label: string): Promise<AbiApp> {
  return launchApp({ profileDir, outputDir: join(RAW_DIR, 'shots'), label })
}

// ---------------------------------------------------------------- startup ---

type StartupMode = 'cold' | 'warm'

interface StartupRun {
  size: CatalogPreset
  link: string
  /** cold: no catalog on disk (the original baseline's only case); warm: the IndexedDB cache from the run before. */
  mode: StartupMode
  firstPaint: number | null
  readyToShow: number | null
  authDone: number | null
  homeContent: number | null
  /** Every type held a complete list, from the cache or the network, whichever came first. */
  catalogInMemory: number | null
  /** Every type's list came fresh from the provider (`sync:done`). */
  fullCatalog: number | null
  syncFailed: boolean
  longTaskCount: number
  longTaskTotal: number
  longTaskMax: number
}

async function startupRuns(size: CatalogPreset, link: LinkProfile, runs: number): Promise<StartupRun[]> {
  const mock = await startMockProvider({ media, size, latencyMs: 0 })
  const profile = newProfileDir()
  const results: StartupRun[] = []
  try {
    // Setup launch (not measured): sign in once and let the first sync finish.
    log(`startup ${size}/${link.name}: setup`)
    const setup = await launch(profile, `setup-${size}`)
    await addXtreamSource(setup.page, mock)
    await expectHomeWithContent(setup.page, 120_000)
    await waitForTimeline(setup, syncSettled, FULL_CATALOG_TIMEOUT_MS)
    await setup.close()
    mock.update({ latencyMs: link.latencyMs, bandwidthBytesPerSec: link.bandwidthBytesPerSec })

    for (let run = 1; run <= runs; run += 1) {
      for (const mode of ['cold', 'warm'] as const) {
        log(`startup ${size}/${link.name}: ${mode} run ${run}/${runs}`)
        // Cold: the catalog cache is removed, so the lists come from the provider as before the cache existed.
        if (mode === 'cold') rmSync(join(profile, 'IndexedDB'), { recursive: true, force: true })
        const app = await launch(profile, `startup-${size}-${mode}-${run}`)
        try {
          await expectHomeWithContent(app.page, 120_000)
          const timeline = await waitForTimeline(app, startupSettled, FULL_CATALOG_TIMEOUT_MS)
          writeFileSync(join(RAW_DIR, `startup-${size}-${link.latencyMs}-${mode}-${run}.json`), JSON.stringify(timeline, null, 2))
          const syncMarks = timeline.marks.filter((item) => item.name.startsWith('sync:'))
          const syncStart = syncMarks.find((item) => item.name === 'sync:start')?.t ?? null
          const syncEnd = syncSettled(timeline) ? Math.max(...syncMarks.filter((item) => item.name !== 'sync:start').map((item) => item.t)) : null
          const longTasks = syncStart !== null
            ? timeline.longTasks.filter((task) => task.process === 'renderer' && task.start >= syncStart && task.start <= (syncEnd ?? Infinity))
            : []
          results.push({
            size,
            link: link.name,
            mode,
            firstPaint: mark(timeline, 'renderer:first-contentful-paint')?.t ?? null,
            readyToShow: mark(timeline, 'main:ready-to-show')?.t ?? null,
            authDone: mark(timeline, 'connect:auth-done')?.t ?? null,
            homeContent: mark(timeline, 'renderer:home-first-content')?.t ?? null,
            catalogInMemory: catalogCompleteAt(timeline),
            fullCatalog: syncEnd,
            syncFailed: syncMarks.some((item) => item.name === 'sync:failed'),
            longTaskCount: longTasks.length,
            longTaskTotal: longTasks.reduce((sum, task) => sum + task.duration, 0),
            longTaskMax: longTasks.reduce((max, task) => Math.max(max, task.duration), 0)
          })
          // Let the cache write finish (after the measurement) so the warm run that follows has it all.
          if (mode === 'cold') await app.page.waitForTimeout(3000)
        } finally {
          await app.close()
        }
      }
    }
  } finally {
    await mock.close()
    removeProfileDir(profile)
  }
  return results
}

/** When the last of the three types first held a complete list (`cache:committed` or `sync:done`). */
function catalogCompleteAt(timeline: MergedPerfTimeline): number | null {
  const times = ['live', 'vod', 'series'].map((type) => {
    const candidates = timeline.marks
      .filter((item) => (item.name === 'sync:done' || item.name === 'cache:committed') && item.detail?.type === type)
      .map((item) => item.t)
    return candidates.length ? Math.min(...candidates) : null
  })
  return times.every((time) => time !== null) ? Math.max(...(times as number[])) : null
}

// --------------------------------------------------------------- playback ---

interface PlaybackSample {
  scenario: string
  link: string
  /** Click to the first sampled position change of the new stream, ms. */
  clickToProgress: number | null
  /** In-app breakdown, ms after the click. */
  steps: Record<string, number | null>
  mpvAlreadyRunning: boolean
}

async function clickAndTime(app: AbiApp, scenario: string, link: string, pathIncludes: string, click: () => Promise<void>): Promise<PlaybackSample> {
  const page = app.page
  const mpvAlreadyRunning = (await helpersOf(app.pid)).some((proc) => proc.name === 'mpv.exe')
  // Wall clock of the page (same machine clock as this process).
  const timing = timeToMpvProgress(page, pathIncludes, 45_000)
  const clickedAt = Date.now()
  await click()
  const progressAt = await timing
  // Snapshots are pushed (time churn coalesced to 200 ms); give the renderer's
  // own first-progress mark time to land in the timeline.
  await page.waitForTimeout(700)
  const timeline = await app.perf()
  const clickT = clickedAt - timeline.timeOrigin
  const after = (name: string) => {
    const found = mark(timeline, name, clickT - 50)
    return found ? Math.round(found.t - clickT) : null
  }
  return {
    scenario,
    link,
    clickToProgress: progressAt === null ? null : progressAt - clickedAt,
    mpvAlreadyRunning,
    steps: Object.fromEntries(['play:request', 'player:overlay-hidden', ...PLAYBACK_STEPS].map((name) => [name, after(name)]))
  }
}

/**
 * Renderer marks (route, engine, the `mpvOpen` call and its answer, the first
 * pushed snapshot showing the new stream advancing) and main marks of the mpv
 * session and load (src/main/mpv/session.ts). Spawn and pipe marks only appear
 * when mpv was not already running (pre-warmed) at the click.
 */
const PLAYBACK_STEPS = [
  'route:player-chunk-loaded',
  'player:engine-resolved',
  'mpv:open-call',
  'mpv:open',
  'mpv:spawn',
  'mpv:session-ready',
  'mpv:loadfile-sent',
  'mpv:loadfile-replied',
  'mpv:open-resolved',
  'mpv:start-file',
  'mpv:file-loaded',
  'mpv:playback-restart',
  'mpv:first-progress'
]

async function returnHome(page: Page) {
  await leavePlayer(page)
  await closeMiniPlayer(page)
}

async function playbackRuns(link: LinkProfile, runs: number): Promise<PlaybackSample[]> {
  const samples: PlaybackSample[] = []
  const mock = await startMockProvider({ media, size: 'small' })
  const xtreamProfile = newProfileDir()
  const m3uProfile = newProfileDir()
  try {
    log(`playback/${link.name}: setup`)
    const setupX = await launch(xtreamProfile, 'setup-xtream')
    await addXtreamSource(setupX.page, mock)
    await expectHomeWithContent(setupX.page)
    await setupX.close()
    const setupM = await launch(m3uProfile, 'setup-m3u')
    await addM3uSource(setupM.page, mock.m3uUrl('ts'))
    await expectHomeWithContent(setupM.page)
    await setupM.close()
    mock.update({ latencyMs: link.latencyMs, bandwidthBytesPerSec: link.bandwidthBytesPerSec })

    for (let run = 1; run <= runs; run += 1) {
      for (const [profile, protocol, ext] of [[xtreamProfile, 'HLS', 'm3u8'], [m3uProfile, 'MPEG-TS', 'ts']] as const) {
        log(`playback/${link.name}: ${protocol} run ${run}/${runs}`)
        const app = await launch(profile, `play-${protocol}-${run}`)
        try {
          const page = app.page
          await expectHomeWithContent(page)
          await openRoute(page, '/live')
          await page.getByRole('button', { name: KNOWN.liveCategory, exact: true }).click()
          if (args['wait-prewarm']) await waitForTimeline(app, (timeline) => !!mark(timeline, 'mpv:session-ready'), 15_000)
          const coldName = args['wait-prewarm'] ? 'ilk kanal, mpv önceden ısıtılmış' : 'soğuk ilk kanal'
          samples.push(await clickAndTime(app, `${protocol}: ${coldName}`, link.name, `/1.${ext}`, () => cardButton(page, KNOWN.liveChannels[0]).click()))
          await page.waitForTimeout(1500)
          await revealPlayerControls(page)
          samples.push(await clickAndTime(app, `${protocol}: sıcak kanal değişimi`, link.name, `/2.${ext}`, () =>
            page.getByRole('button', { name: `Sonraki: ${KNOWN.liveChannels[1]}` }).click()
          ))
          await page.waitForTimeout(1500)
          await revealPlayerControls(page)
          samples.push(await clickAndTime(app, `${protocol}: sıcak kanal değişimi`, link.name, `/3.${ext}`, () =>
            page.getByRole('button', { name: `Sonraki: ${KNOWN.liveChannels[2]}` }).click()
          ))
          if (protocol === 'HLS') {
            await returnHome(page)
            await openRoute(page, '/vod')
            await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill('Kayıp Şehir')
            await cardButton(page, KNOWN.film).click()
            const playButton = page.getByRole('button', { name: 'İzle', exact: true })
            await playButton.waitFor()
            samples.push(await clickAndTime(app, 'Film açılışı (MP4)', link.name, '/100001.mp4', () => playButton.click()))
          }
        } finally {
          await app.close()
        }
      }
    }
  } finally {
    await mock.close()
    removeProfileDir(xtreamProfile)
    removeProfileDir(m3uProfile)
  }
  return samples
}

// ----------------------------------------------------------------- report ---

function environment(): string[] {
  const cpu = cpus()[0]?.model.trim() ?? 'bilinmiyor'
  let electronVersion = '?'
  let mpvVersion = '?'
  try {
    electronVersion = (JSON.parse(readFileSync(join(REPO_ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')) as { version: string }).version
  } catch {
    // ignore
  }
  try {
    mpvVersion = execFileSync(MPV_PATH, ['--version']).toString().split('\n')[0]?.trim() ?? ''
  } catch {
    // ignore
  }
  let commit = '?'
  try {
    commit = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim()
  } catch {
    // ignore
  }
  return [
    `- Tarih: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `- Kod: \`${commit}\` (ölçüm işaretleri eklenmiş hali), \`electron-vite build\` çıktısı`,
    `- Makine: ${cpu}, ${cpus().length} mantıksal çekirdek, ${Math.round(totalmem() / 1024 ** 3)} GB bellek, Windows ${release()}`,
    `- Electron ${electronVersion.replace(/^v/, '')}, Node ${process.versions.node}, ${mpvVersion}`
  ]
}

function startupTable(results: StartupRun[]): string[] {
  const groups = new Map<string, StartupRun[]>()
  for (const result of results) {
    const key = `${result.size}|${result.link}|${result.mode}`
    groups.set(key, [...(groups.get(key) ?? []), result])
  }
  const lines = [
    '| Katalog | Bağlantı | Açılış | n | İlk boyama | Pencere hazır | Giriş yanıtı | Ana sayfada ilk içerik | Tam katalog bellekte | Tam katalog sağlayıcıdan | Eşitlemede uzun görev (adet / toplam / en uzun) |',
    '|---|---|---|---|---|---|---|---|---|---|---|'
  ]
  for (const [key, group] of groups) {
    const [size, link, mode] = key.split('|')
    const total = CATALOG_PRESETS[size as CatalogPreset]
    const pick = (fn: (run: StartupRun) => number | null) => group.map(fn).filter((value): value is number => value !== null)
    const cell = (fn: (run: StartupRun) => number | null) => {
      const values = pick(fn)
      return values.length ? `${fmt(median(values))} ms (${range(values)})` : '–'
    }
    const failed = group.some((run) => run.syncFailed) ? ' (eşitleme hatası var)' : ''
    lines.push(
      `| ${size} (${(total.live + total.vod + total.series).toLocaleString('tr-TR')}) | ${link} | ${mode === 'cold' ? 'soğuk' : 'sıcak'} | ${group.length} | ${cell((run) => run.firstPaint)} | ${cell((run) => run.readyToShow)} | ${cell((run) => run.authDone)} | ${cell((run) => run.homeContent)} | ${cell((run) => run.catalogInMemory)} | ${cell((run) => run.fullCatalog)}${failed} | ${fmt(median(pick((run) => run.longTaskCount)))} / ${fmt(median(pick((run) => run.longTaskTotal)), ' ms')} / ${fmt(median(pick((run) => run.longTaskMax)), ' ms')} |`
    )
  }
  return lines
}

function playbackTable(samples: PlaybackSample[]): string[] {
  const groups = new Map<string, PlaybackSample[]>()
  for (const sample of samples) {
    const key = `${sample.scenario}|${sample.link}`
    groups.set(key, [...(groups.get(key) ?? []), sample])
  }
  // Columns that stay empty in every group (spawn on a pre-warmed mpv) are left out.
  const steps = PLAYBACK_STEPS.filter((step) => samples.some((sample) => sample.steps[step] !== null))
  const lines = [
    `| Senaryo | Bağlantı | n | Tıklamadan oynamaya (dış ölçüm) | ${steps.map((step) => `\`${step}\``).join(' | ')} |`,
    `|---|---|---|---|${steps.map(() => '---').join('|')}|`
  ]
  for (const [key, group] of groups) {
    const [scenario, link] = key.split('|')
    const values = group.map((sample) => sample.clickToProgress).filter((value): value is number => value !== null)
    const missing = group.length - values.length
    const stepCells = steps.map((step) => fmt(median(group.map((sample) => sample.steps[step]).filter((value): value is number => value !== null)), ' ms'))
    lines.push(`| ${scenario} | ${link} | ${group.length} | ${fmt(median(values))} ms (${range(values)})${missing ? `, ${missing} ölçümde oynamadı` : ''} | ${stepCells.join(' | ')} |`)
  }
  return lines
}

/** Per scenario: in how many samples an mpv process existed at the click (pre-warmed or still running). */
function mpvRunningSummary(samples: PlaybackSample[]): string {
  const byScenario = new Map<string, { running: number; total: number }>()
  for (const sample of samples) {
    const entry = byScenario.get(sample.scenario) ?? { running: 0, total: 0 }
    entry.total += 1
    if (sample.mpvAlreadyRunning) entry.running += 1
    byScenario.set(sample.scenario, entry)
  }
  return [...byScenario].map(([scenario, { running, total }]) => `${scenario} ${running}/${total}`).join('; ') || '–'
}

const startup: StartupRun[] = []
if (ONLY !== 'playback') {
  for (const size of SIZES) startup.push(...(await startupRuns(size, LOCAL, STARTUP_RUNS)))
  if (SIZES.includes('medium')) startup.push(...(await startupRuns('medium', SLOW, STARTUP_RUNS)))
}
const playback: PlaybackSample[] = []
if (ONLY !== 'startup') {
  playback.push(...(await playbackRuns(LOCAL, PLAYBACK_RUNS)))
  if (!args['no-throttled']) playback.push(...(await playbackRuns(SLOW, Math.max(2, Math.ceil(PLAYBACK_RUNS / 2)))))
}
writeFileSync(join(RAW_DIR, LABEL ? `summary-${LABEL}.json` : 'summary.json'), JSON.stringify({ label: LABEL, startup, playback }, null, 2))

const report = [
  `# Ölçüm${LABEL ? ` (${LABEL})` : ' tabanı'}: ${ONLY === 'all' ? 'açılış ve oynatma' : ONLY === 'startup' ? 'açılış' : 'oynatma'}`,
  '',
  '> **Bu sayılar gerçek bir IPTV sağlayıcısından değil, bu makinede çalışan sentetik yerel bir sağlayıcıdan (`e2e/mock-provider`) alınmıştır.** Ağ gecikmesi ve bant genişliği yapaydır; gerçek panellerde sunucu yanıt süreleri ve yayın başlangıçları çok daha değişkendir. Sayılar mutlak hız iddiası değil, aynı düzenekte sonraki değişikliklerin karşılaştırılacağı tabandır.',
  '',
  '> Uygulama uçtan uca test kipinde çalıştı (`ABI_E2E=1`): pencere ekran dışında, etkinleştirilmeden gösterildi, sessiz klipler ve kapalı ses ile. Ekran dışı pencere çizimi ve mpv gömmesi normal pencereyle aynı yoldan geçer, ama kompozisyon ve GPU zamanlaması görünür pencereden biraz farklı olabilir.',
  '',
  '## Ortam',
  '',
  ...environment(),
  `- Komut: \`npm run perf:baseline\` (açılış ${STARTUP_RUNS} tur, oynatma ${PLAYBACK_RUNS} tur; kısıtlı bağlantıda oynatma ${Math.max(2, Math.ceil(PLAYBACK_RUNS / 2))} tur)`,
  '',
  '## Yöntem',
  '',
  '- Her katalog boyutu için önce bir kurulum açılışında sahte Xtream kaynağı giriş formundan eklenir ve ilk tam eşitleme bitirilir. Ölçülen açılışlar bu profille yapılan yeniden açılışlardır, kaynak kayıtlı. **Soğuk:** IndexedDB katalog önbelleği her açılıştan önce silinir, listeler sağlayıcıdan gelir (önbellekten önceki taban yöntemiyle aynı). **Sıcak:** bir önceki açılışın bıraktığı önbellekle; liste önbellekten gelir, arkada sağlayıcıdan tazelenir.',
  '- **Tam katalog bellekte:** üç türün tam listesinin önbellekten ya da ağdan (hangisi önce) bellekte olduğu an (`cache:committed` / `sync:done`). **Tam katalog sağlayıcıdan:** üç türün de sağlayıcıdan taze gelmesi (`sync:done`); taban raporundaki "Tam katalog" sütunu budur.',
  '- Süreler main sürecin başlangıcına göredir (`ABI_PERF=1` ile açılan `perfMark` zaman çizelgesi, bkz. `src/shared/perf.ts`). Değerler ortanca; parantez içinde en küçük ve en büyük.',
  '- **İlk boyama:** renderer `first-contentful-paint`. **Ana sayfada ilk içerik:** ana sayfanın kanal listesiyle ilk çizildiği an (`renderer:home-first-content`). **Tam katalog:** canlı, film ve dizi tam listelerinin üçünün de eklenmesi (`sync:done`). Küçük katalogda veri, pencere ilk kez boyanmadan önce gelebilir; kullanıcının içeriği gördüğü an ikisinden geç olanıdır. **Uzun görev:** renderer ana iş parçacığında 50 ms üstü görevler (Long Tasks API), ilk `sync:start` ile son `sync:done` arasında.',
  '- Oynatmada "tıklamadan oynamaya", tıklama anından, sayfanın içinden 40 ms aralıkla `mpv-get-state` okunarak yeni yayının konumunun ilk kez ilerlediği ana kadardır (önceki kanalın konumu yeni yola sızdığı için yalnızca `timePos > 0` yetmez; bkz. `createMpvProgressProbe`). Bu, mpv\'nin ilk kareyi göstermesini en çok bir örnekleme aralığı kadar geç yakalar.',
  '- Adım sütunları tıklamaya göre uygulama içi işaretlerdir (ortanca). Renderer: `mpv:open-call` / `mpv:open-resolved` (`mpvOpen` çağrısı ve yanıtı), `mpv:first-progress` (itilen anlık görüntülerden yeni yayının ilk ilerlediği an; zaman değişimleri 200 ms\'de bir birleştirildiği için dış ölçümden kaba). Main (`src/main/mpv/session.ts`): `mpv:open` (denetleyiciye ulaştı, TLS denetiminden sonra), `mpv:spawn` / `mpv:session-ready` (süreç başlatma, boru ve gözlemciler; yalnızca mpv önceden ısıtılmamışsa), `mpv:loadfile-sent` / `-replied`, mpv\'nin kendi olayları `mpv:start-file`, `mpv:file-loaded`, `mpv:playback-restart` (ilk kare ve ses).',
  '- HLS ölçümleri Xtream kaynağıyla yapılır (uygulama canlı yayını her zaman `.m3u8` olarak açar). MPEG-TS ölçümleri aynı katalogdan `output=ts` ile üretilen M3U kaynağıyla yapılır. Canlı klip 2 sn\'lik parçalarla, yayıncı gibi gerçek zamanlı akar; TS bağlantısında ilk 1 sn\'lik veri hemen gönderilir.',
  `- Kısıtlı bağlantı: her yanıta ${THROTTLED.latencyMs} ms gecikme ve bağlantı başına ${THROTTLED.bandwidthBytesPerSec / 1024 / 1024} MB/s sınır.`,
  '',
  ...(startup.length > 0 ? ['## Açılış', '', ...startupTable(startup), ''] : []),
  ...(playback.length > 0
    ? [
        '## Oynatma açılışı',
        '',
        ...playbackTable(playback),
        '',
        `Tıklama anında mpv süreci ayakta mıydı: ${mpvRunningSummary(playback)}.`,
        ''
      ]
    : []),
  '## Ham veri',
  '',
  'Her turun birleşik zaman çizelgesi (main ve renderer işaretleri, uzun görevler) `e2e/.output/perf/` altına yazılır; bu dizin depoya girmez.'
]

const outFile = args.out ?? join(REPO_ROOT, 'docs', 'olcumler', `${new Date().toISOString().slice(0, 10)}-${LABEL ?? 'taban'}.md`)
mkdirSync(join(REPO_ROOT, 'docs', 'olcumler'), { recursive: true })
writeFileSync(outFile, report.join('\n') + '\n')
log(`report written to ${outFile}`)
