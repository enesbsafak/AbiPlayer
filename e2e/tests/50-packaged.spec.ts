// What only the packaged build can get wrong: the catalog worker loading from
// inside app.asar (on failure the client silently falls back to the page),
// and mpv, ffprobe and ffmpeg resolved from the package's own resources.
// Tagged @packaged, so `npx playwright test -c e2e/playwright.packaged.config.ts`
// runs it against dist/win-unpacked; the normal suite runs it against out/.

import { resolve } from 'node:path'
import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { helpersOf } from '../support/processes.ts'
import { E2E_TARGET, TARGET_BINARY_DIRS } from '../support/paths.ts'
import { observe } from '../support/known-bugs.ts'
import {
  addXtreamSource,
  cardButton,
  expectHomeWithContent,
  leavePlayer,
  openRoute,
  playLiveChannel,
  waitForMpvProgress
} from '../support/flows.ts'

const sameDir = (file: string, dir: string) => resolve(file).toLowerCase().startsWith(resolve(dir).toLowerCase())

test.describe('paketlenmiş uygulama', () => {
  test('katalog işçide alınır; canlı kanal mpv ile, film altyazısı ffprobe ve ffmpeg ile paketten çalışır', { tag: '@packaged' }, async ({ launch, mock, closeApp }) => {
    const app = await launch()
    const { page } = app
    expect(await app.electron.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(E2E_TARGET === 'packaged')

    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)

    // Every list went through the worker, not the in-page fallback.
    await expect
      .poll(async () => (await app.perf()).marks.filter((mark) => mark.name === 'ingest:committed').map((mark) => mark.detail?.type).sort(), {
        timeout: 60_000
      })
      .toEqual(['live', 'series', 'vod'])
    const committed = (await app.perf()).marks.filter((mark) => mark.name === 'ingest:committed')
    expect(committed.map((mark) => mark.detail?.isolated), 'ingest ran in a Worker').toEqual([true, true, true])
    const workerUrls = page.workers().map((worker) => worker.url())
    observe(`workers: ${workerUrls.join(', ')}`)
    expect(workerUrls.some((url) => url.includes('catalog.worker'))).toBe(true)
    if (E2E_TARGET === 'packaged') expect(workerUrls.find((url) => url.includes('catalog.worker'))).toContain('app.asar')
    expect(app.logs.filter((line) => line.includes('[catalog-worker]')), 'no worker failure was logged').toEqual([])

    // Live channel through the mpv this build ships.
    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
    await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 2, timeout: 45_000 })
    const [mpv] = (await helpersOf(app.pid)).filter((proc) => proc.name === 'mpv.exe')
    expect(mpv, 'mpv is running').toBeDefined()
    const mpvExe = mpv?.commandLine.match(/^"([^"]+)"|^(\S+)/)?.slice(1).find(Boolean) ?? ''
    observe(`mpv: ${mpvExe}`)
    expect(sameDir(mpvExe, TARGET_BINARY_DIRS.mpv), `mpv from ${TARGET_BINARY_DIRS.mpv}`).toBe(true)
    await leavePlayer(page)

    // The film with two subtitle tracks: playing with mpv, then probed and
    // one track extracted through the same IPC the HTML5 engine uses. A
    // packaged build only ever resolves the ffmpeg and ffprobe it ships.
    await openRoute(page, '/vod')
    await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill('Çift Dilli')
    await cardButton(page, KNOWN.dualAudioFilm).click()
    await page.getByRole('button', { name: 'İzle', exact: true }).click()
    await waitForMpvProgress(page, { pathIncludes: '/100002.mkv', advanceBy: 1, timeout: 45_000 })

    const filmUrl = `${mock.url}/movie/${mock.username}/${mock.password}/100002.mkv`
    const tracks = await page.evaluate(
      (url) => window.electron!.probeEmbeddedSubtitles(url, { jobId: 'e2e-probe-1', timeoutMs: 30_000 }),
      filmUrl
    )
    expect(tracks.map((track) => track.language).sort()).toEqual(['eng', 'tur'])
    const english = tracks.find((track) => track.language === 'eng')
    expect(english).toBeDefined()
    const extracted = await page.evaluate(
      ({ url, index }) => window.electron!.extractEmbeddedSubtitle(url, index, { jobId: 'e2e-extract-1', timeoutMs: 60_000 }),
      { url: filmUrl, index: english?.index ?? -1 }
    )
    expect(extracted?.format).toBe('vtt')
    expect(extracted?.content).toContain('English subtitle line 1')
    expect(extracted?.truncated ?? false).toBe(false)
    await app.shot('film')

    const report = await closeApp(app)
    expect(report.exitedCleanly).toBe(true)
    expect(report.strays, 'no mpv, ffmpeg or ffprobe left behind').toEqual([])
  })
})
