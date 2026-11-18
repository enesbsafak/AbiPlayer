import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import {
  addXtreamSource,
  cardButton,
  closeMiniPlayer,
  continueTile,
  expectHomeWithContent,
  leavePlayer,
  mpvState,
  openRoute,
  revealPlayerControls,
  waitForMpvProgress
} from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'

// The mock's first series: id 500001, five episodes a season, episode ids
// <series><season><episode>; even episodes are the MKV clip with Turkish and
// English subtitles, odd ones the MP4 film clip.
const EPISODE = (season: number, episode: number) => `/${500001 * 100 + season * 10 + episode}.`
/** Length of the MKV clip (mock-provider/media.ts). */
const MKV_SECONDS = 300

async function englishSubtitleId(page: Page): Promise<number | undefined> {
  return (await mpvState(page)).tracks.find((track) => track.type === 'sub' && track.lang === 'eng')?.id
}

async function playNext(page: Page): Promise<void> {
  await revealPlayerControls(page)
  await page.getByRole('button', { name: /^Sonraki: / }).click()
}

test.describe('dizide sonraki bölüm', () => {
  test('sonraki tuşu, bölüm bitince geçiş ve altyazının hatırlanması', async ({ launch, mock }) => {
    test.setTimeout(240_000)
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)

    await openRoute(page, '/series')
    await page.getByRole('textbox', { name: 'Dizi ara', exact: true }).fill('Sessiz Liman')
    await cardButton(page, KNOWN.series).click()
    await expect(page.getByRole('heading', { name: KNOWN.series })).toBeVisible()
    await page.getByRole('button', { name: /S01E02/ }).first().click()
    await expect(page).toHaveURL(/#\/player/)
    await waitForMpvProgress(page, { pathIncludes: EPISODE(1, 2), advanceBy: 1, timeout: 45_000 })

    // Subtitles are off by default; the viewer turns the English ones on.
    await expect.poll(async () => (await mpvState(page)).sid, { message: 'subtitles start off', timeout: 10_000 }).toBeNull()
    await revealPlayerControls(page)
    await page.getByRole('button', { name: 'Altyazı seç', exact: true }).click()
    await page.getByRole('button', { name: 'English', exact: true }).click()
    const english = await englishSubtitleId(page)
    expect(english, 'the clip has an English subtitle track').toBeDefined()
    await expect.poll(async () => (await mpvState(page)).sid, { timeout: 10_000 }).toBe(english)

    // The next button steps through the series, not the film list.
    await playNext(page)
    await waitForMpvProgress(page, { pathIncludes: EPISODE(1, 3), advanceBy: 1, timeout: 45_000 })
    await playNext(page)
    await waitForMpvProgress(page, { pathIncludes: EPISODE(1, 4), advanceBy: 1, timeout: 45_000 })

    // The series' subtitle choice came along, although the episode in between had none.
    await expect.poll(async () => (await mpvState(page)).sid, { timeout: 10_000 }).toBe(await englishSubtitleId(page))
    await app.shot('subtitle-remembered')

    // The episode ends: the next one is announced and starts by itself.
    await page.evaluate((seconds) => window.electron!.mpvSeekTo(seconds), MKV_SECONDS - 3)
    await expect(page.getByText(/^Sıradaki bölüm \d+ sn sonra başlıyor$/)).toBeVisible({ timeout: 30_000 })
    await app.shot('next-episode-card')
    await waitForMpvProgress(page, { pathIncludes: EPISODE(1, 5), advanceBy: 1, timeout: 45_000 })
    await expect(page.getByText(/^Sıradaki bölüm/)).toHaveCount(0)

    // Far enough in to be kept in the history, then out of the player.
    await page.evaluate((seconds) => window.electron!.mpvSeekTo(seconds), 120)
    await expect.poll(async () => (await mpvState(page)).timePos, { timeout: 20_000 }).toBeGreaterThanOrEqual(120)
    await page.waitForTimeout(12_000)
    await leavePlayer(page)
    await closeMiniPlayer(page)

    // Continued from the home page, the episode still knows what comes next
    // (the first episode of the second season).
    await openRoute(page, '/')
    await expect(continueTile(page)).toBeVisible()
    await continueTile(page).getByRole('button', { name: / — kaldığın yerden devam et$/ }).click()
    await expect(page).toHaveURL(/#\/player/)
    await waitForMpvProgress(page, { pathIncludes: EPISODE(1, 5), advanceBy: 1, timeout: 45_000 })
    await revealPlayerControls(page)
    await expect(page.getByRole('button', { name: /^Sonraki: / })).toBeEnabled({ timeout: 15_000 })
    await playNext(page)
    const { last } = await waitForMpvProgress(page, { pathIncludes: EPISODE(2, 1), advanceBy: 1, timeout: 45_000 })
    observe(`next episode after the home page's continue: ${last.path?.split('/').pop()}`)
  })
})
