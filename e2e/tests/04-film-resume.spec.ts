import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import type { MockProvider } from '../mock-provider/server.ts'
import { addXtreamSource, cardButton, expectHomeWithContent, leavePlayer, mpvState, openRoute, waitForMpvProgress } from '../support/flows.ts'
import { knownBug, observe } from '../support/known-bugs.ts'

const FILM_PATH = '/100001.mp4'
const SEEK_TO = 120

interface StoredProgress {
  key: string
  position: number
  duration: number
}

async function storedProgress(page: Page): Promise<StoredProgress[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('iptv-player-store')
    const parsed = raw ? (JSON.parse(raw) as { state?: { watchProgress?: StoredProgress[] } }) : null
    return (parsed?.state?.watchProgress ?? []).map(({ key, position, duration }) => ({ key, position, duration }))
  })
}

async function filmProgress(page: Page): Promise<number | null> {
  const entry = (await storedProgress(page)).find((item) => item.key.includes(FILM_PATH))
  return entry ? Math.round(entry.position) : null
}

/** Opens the film, jumps to SEEK_TO and stays long enough for the 10 s progress save. */
async function watchFilmMidway(page: Page, mock: MockProvider): Promise<void> {
  await addXtreamSource(page, mock)
  await expectHomeWithContent(page)
  await openRoute(page, '/vod')
  await page.getByPlaceholder('Kanal ara...').fill('Kayıp Şehir')
  await cardButton(page, KNOWN.film).click()
  await page.getByRole('button', { name: 'Filmi Oynat' }).click()
  await expect(page).toHaveURL(/#\/player/)
  await waitForMpvProgress(page, { pathIncludes: FILM_PATH, advanceBy: 1, timeout: 45_000 })

  // Jumping through the app's own IPC bridge: the slider would need pixel maths
  // and the point here is resume behaviour, not the seek control.
  await page.evaluate((seconds) => window.electron!.mpvSeekTo(seconds), SEEK_TO)
  await expect.poll(async () => (await mpvState(page)).timePos, { timeout: 20_000 }).toBeGreaterThanOrEqual(SEEK_TO)
  await expect.poll(() => filmProgress(page), { timeout: 25_000, intervals: [1000] }).toBeGreaterThanOrEqual(SEEK_TO)
}

test.describe('film ve kaldığı yerden devam', () => {
  test('film yarıda bırakılır; mini oynatıcıdan ve "Devam Et" kartından dönüş bugünkü haliyle kaydedilir', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await watchFilmMidway(page, mock)
    const savedBeforeLeaving = await filmProgress(page)
    await app.shot('film-midway')

    await leavePlayer(page)
    await expect(page.getByRole('region', { name: 'Mini oynatıcı' })).toBeVisible()
    const whileMini = await mpvState(page)
    observe(`F1-03: in the mini player mpv running=${whileMini.running}, path=${whileMini.path ? 'set' : 'null'}`)
    await app.shot('mini-player')

    // Back through the mini player.
    await page.getByRole('button', { name: 'Oynatıcıyı büyüt' }).click()
    await expect(page).toHaveURL(/#\/player/)
    const expanded = await waitForMpvProgress(page, { pathIncludes: FILM_PATH, advanceBy: 1, timeout: 45_000 })
    await page.waitForTimeout(12_000) // one more progress save
    const afterExpand = await mpvState(page)
    const savedAfterExpand = await filmProgress(page)
    observe(
      `F1-03: saved ${savedBeforeLeaving}s before leaving; after expanding the mini player playback resumed at ` +
        `${Math.round(expanded.first.timePos)}s and the saved progress is now ${savedAfterExpand ?? 'gone'} (position ${Math.round(afterExpand.timePos)}s)`
    )
    await app.shot('after-expand')

    // Back through the dashboard's "Devam Et" row.
    await leavePlayer(page)
    await page.getByRole('button', { name: 'Oynatmayı durdur' }).click()
    await openRoute(page, '/')
    const continueCard = page.getByRole('button', { name: `${KNOWN.film} — kaldığın yerden devam et` })
    await expect(page.getByRole('heading', { name: 'Canlı TV' })).toBeVisible()
    if (await continueCard.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
      await continueCard.click()
      const resumed = await waitForMpvProgress(page, { pathIncludes: FILM_PATH, advanceBy: 1, timeout: 45_000 })
      await page.waitForTimeout(3000)
      const settled = await mpvState(page)
      observe(`resume from "Devam Et": first position ${Math.round(resumed.first.timePos)}s, ${Math.round(settled.timePos)}s three seconds later`)
      await app.shot('continue-watching')
    } else {
      observe('the "Devam Et" row has no card for the film after returning via the mini player')
      await app.shot('no-continue-card')
    }
  })

  test('F1-03: mini oynatıcıdan büyütünce film kaldığı yerden sürer', async ({ launch, mock }) => {
    knownBug('F1-03', 'Mini oynatıcı oynatmıyor; dönüşte film 0:00\'dan başlıyor ve kayıtlı ilerleme eziliyor')
    const app = await launch()
    const { page } = app
    await watchFilmMidway(page, mock)
    await leavePlayer(page)
    await page.getByRole('button', { name: 'Oynatıcıyı büyüt' }).click()
    const expanded = await waitForMpvProgress(page, { pathIncludes: FILM_PATH, advanceBy: 1, timeout: 45_000 })
    expect(expanded.last.timePos).toBeGreaterThanOrEqual(SEEK_TO - 10)
  })
})
