import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import type { MockProvider } from '../mock-provider/server.ts'
import {
  addXtreamSource,
  cardButton,
  closeMiniPlayer,
  continueTile,
  expectHomeWithContent,
  expectSuspendedMiniPlayer,
  leavePlayer,
  miniPlayerResume,
  mpvState,
  openRoute,
  pressAndProbe,
  revealPlayerControls,
  waitForMpvProgress
} from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'

const FILM_PATH = '/100001.mp4'
const FILM_STREAM_ID = '100001'
const SEEK_TO = 120
/** The app rewinds a few seconds on resume (RESUME_BACKSTEP_SECONDS); allow for it and for seek granularity. */
const RESUME_TOLERANCE = 10

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

/**
 * Watch progress is keyed by the media key, `movie:<sourceId>:<streamId>`
 * (src/shared/playback), not by the stream URL.
 */
async function filmProgress(page: Page): Promise<number | null> {
  const entry = (await storedProgress(page)).find((item) => item.key.startsWith('movie:') && item.key.endsWith(`:${FILM_STREAM_ID}`))
  return entry ? Math.round(entry.position) : null
}

/** Opens the film, jumps to SEEK_TO and stays long enough for the 10 s progress save. */
async function watchFilmMidway(page: Page, mock: MockProvider): Promise<void> {
  await addXtreamSource(page, mock)
  await expectHomeWithContent(page)
  await openRoute(page, '/vod')
  await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill('Kayıp Şehir')
  await cardButton(page, KNOWN.film).click()
  await page.getByRole('button', { name: 'İzle', exact: true }).click()
  await expect(page).toHaveURL(/#\/player/)
  await waitForMpvProgress(page, { pathIncludes: FILM_PATH, advanceBy: 1, timeout: 45_000 })

  // Jumping through the app's own IPC bridge: the slider would need pixel maths
  // and the point here is resume behaviour, not the seek control.
  await page.evaluate((seconds) => window.electron!.mpvSeekTo(seconds), SEEK_TO)
  await expect.poll(async () => (await mpvState(page)).timePos, { timeout: 20_000 }).toBeGreaterThanOrEqual(SEEK_TO)
  await expect.poll(() => filmProgress(page), { timeout: 25_000, intervals: [1000] }).toBeGreaterThanOrEqual(SEEK_TO)
}

/** Samples the saved position for `ms` and returns the lowest value seen. */
async function lowestSavedDuring(page: Page, ms: number): Promise<number | null> {
  const deadline = Date.now() + ms
  let lowest: number | null = null
  while (Date.now() < deadline) {
    const saved = await filmProgress(page)
    if (saved === null) return null
    lowest = lowest === null ? saved : Math.min(lowest, saved)
    await page.waitForTimeout(500)
  }
  return lowest
}

async function expectResumedNear(page: Page, position: number): Promise<number> {
  await waitForMpvProgress(page, { pathIncludes: FILM_PATH, advanceBy: 1, timeout: 45_000 })
  await expect.poll(async () => (await mpvState(page)).timePos, { timeout: 20_000 }).toBeGreaterThanOrEqual(position - RESUME_TOLERANCE)
  await expect(page.getByText(/konumundan devam ediliyor/)).toBeVisible()
  return (await mpvState(page)).timePos
}

test.describe('film ve kaldığı yerden devam', () => {
  test('F1-03: oynatıcıdan çıkınca oynatma askıya alınır; büyütünce ve "Devam Et" kartından film kaldığı yerden sürer', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await watchFilmMidway(page, mock)
    await app.shot('film-midway')

    // F1-08: clicking the seek bar focuses a range input; shortcuts must keep working.
    // Clicked where its thumb already is, so the click is a seek to about here.
    await revealPlayerControls(page)
    const scrubber = page.getByRole('slider', { name: 'Oynatma ilerlemesi' })
    const box = (await scrubber.boundingBox())!
    const now = Number(await scrubber.getAttribute('aria-valuenow'))
    const max = Number(await scrubber.getAttribute('aria-valuemax'))
    await page.mouse.click(box.x + (box.width * now) / max, box.y + box.height / 2)
    await expect(scrubber).toBeFocused()
    await expect.poll(async () => (await mpvState(page)).timePos, { timeout: 5000 }).toBeGreaterThanOrEqual(SEEK_TO - RESUME_TOLERANCE)
    expect(await pressAndProbe(page, 'k'), 'k toggles pause while the seek bar has focus').toBe(true)
    await expect.poll(async () => (await mpvState(page)).paused, { timeout: 5000 }).toBe(true)
    expect(await pressAndProbe(page, 'k')).toBe(true)
    await expect.poll(async () => (await mpvState(page)).paused, { timeout: 5000 }).toBe(false)

    // Leaving the player suspends playback and shows an honest card.
    await leavePlayer(page)
    await expectSuspendedMiniPlayer(page, 'vod')
    await app.shot('mini-player')
    const savedAtSuspend = await filmProgress(page)
    expect(savedAtSuspend, 'leaving saved the position').not.toBeNull()
    expect(savedAtSuspend!).toBeGreaterThanOrEqual(SEEK_TO)

    // F1-09: outside /player the arrows and Space belong to the page, not the player.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    for (const key of ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'k']) {
      expect(await pressAndProbe(page, key), `${key} is not taken over outside the player`).toBe(false)
    }
    expect((await mpvState(page)).path, 'no key press restarted playback').toBeNull()

    // "Devam et" on the card loads the film again from the saved position.
    await miniPlayerResume(page, 'vod').click()
    await expect(page).toHaveURL(/#\/player/)
    const resumedAt = await expectResumedNear(page, savedAtSuspend!)
    // The restarted film reports low positions until the seek lands, and the
    // next save comes 10 s later: the saved position must never go down.
    const lowestAfterExpand = await lowestSavedDuring(page, 12_000)
    observe(`F1-03: saved ${savedAtSuspend}s at suspend; resumed at ${Math.round(resumedAt)}s; lowest saved value in the next 12 s: ${lowestAfterExpand}`)
    expect(lowestAfterExpand).not.toBeNull()
    expect(lowestAfterExpand!).toBeGreaterThanOrEqual(savedAtSuspend!)
    await app.shot('after-expand')

    // Close it from the card, then come back through home's "Kaldığın yerden" tile.
    await leavePlayer(page)
    await expectSuspendedMiniPlayer(page, 'vod')
    await closeMiniPlayer(page)
    const savedBeforeContinue = await filmProgress(page)
    expect(savedBeforeContinue!).toBeGreaterThanOrEqual(savedAtSuspend!)
    await openRoute(page, '/')
    await expect(continueTile(page)).toBeVisible()
    await expect(continueTile(page).getByRole('heading', { name: KNOWN.film, exact: true })).toBeVisible()
    await app.shot('home-continue-tile')
    await continueTile(page).getByRole('button', { name: `${KNOWN.film} — kaldığın yerden devam et`, exact: true }).click()
    await expect(page).toHaveURL(/#\/player/)
    const continuedAt = await expectResumedNear(page, savedBeforeContinue!)
    observe(`"Devam Et": saved ${savedBeforeContinue}s, resumed at ${Math.round(continuedAt)}s`)
    await app.shot('continue-watching')
  })
})
