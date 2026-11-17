import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { ADDON_KNOWN } from '../mock-provider/addons.ts'
import {
  cardButton,
  closeMiniPlayer,
  continueTile,
  expectSuspendedMiniPlayer,
  leavePlayer,
  mpvState,
  openRoute,
  revealPlayerControls,
  waitForMpvProgress
} from '../support/flows.ts'
import { grid } from '../support/catalog.ts'
import {
  addonProgress,
  categoryList,
  closeStreamPicker,
  dialogOpenedSince,
  expectNoAddonSecrets,
  installAddons,
  mainLogLinesWithSecrets,
  profileFilesHoldingSecrets,
  shotAtSmallestWindow,
  streamCandidates,
  streamPicker,
  watchForDialogs
} from '../support/addons.ts'
import { observe } from '../support/known-bugs.ts'

// Playing from add-on sources against the local fake add-ons: a film's
// detail from the catalogue add-on's meta, the stream picker filled by the
// stream add-on (two playable candidates; a peer-to-peer and an external one
// never listed), playback through the stream URL's redirect, the mini player
// and "Kaldığın yerden", the picker's empty and failed states, a series with
// specials and its next episode chosen by itself, and after a restart the
// picker again instead of a failure (nothing of a stream URL survives).

const SEEK_TO = 120
/** The app rewinds a few seconds on resume (RESUME_BACKSTEP_SECONDS); allow for it and for seek granularity. */
const RESUME_TOLERANCE = 10

/** From a film's detail (or the grid) back to the Filmler grid. */
async function backToFilmGrid(page: Page): Promise<void> {
  const back = page.getByRole('button', { name: 'Geri', exact: true })
  const films = grid(page, 'Filmler')
  // The grid stays mounted (hidden) under an open detail.
  await expect.poll(async () => (await back.isVisible()) || (await films.isVisible())).toBe(true)
  if (await back.isVisible()) await back.click()
  await expect(films).toBeVisible()
}

/** Opens a film of the visible grid and presses its "İzle" (or "Devam et"). */
async function openFilmAndWatch(page: Page, name: string): Promise<void> {
  await cardButton(page, name).click()
  const detail = page.getByRole('region', { name, exact: true })
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible()
  await detail.getByRole('button', { name: /^(İzle|Devam et)$/ }).click()
}

test.describe('eklenti kaynağından oynatma', () => {
  test('yayın seçici, oynatma, boş ve hatalı durumlar, dizinin sonraki bölümü, yeniden başlatmadan sonra yeniden seçim', async ({
    launch,
    addons,
    profileDir,
    closeApp
  }) => {
    test.setTimeout(540_000)
    const first = await launch({ label: 'first' })
    const { page } = first
    await installAddons(page, addons)

    // The film's detail comes from the catalogue add-on's meta.
    await openRoute(page, '/vod')
    await categoryList(page).getByRole('button', { name: ADDON_KNOWN.shortCatalog, exact: true }).click()
    await cardButton(page, ADDON_KNOWN.film).click()
    const filmDetail = page.getByRole('region', { name: ADDON_KNOWN.film, exact: true })
    await expect(filmDetail.getByRole('heading', { name: ADDON_KNOWN.film, exact: true })).toBeVisible()
    await expect(filmDetail).toContainText(ADDON_KNOWN.filmPlot)
    await expect(filmDetail).toContainText('Yönetmen: Zeynep Uydurma')
    await expect(filmDetail).toContainText('Oyuncular: Ayşe Örnek, Mehmet Deneme')
    await expect(filmDetail).toContainText('104 min')
    expect(addons.requests().some((request) => request.route === 'meta' && request.id === ADDON_KNOWN.filmId)).toBe(true)
    await first.shot('film-detail')

    // "İzle" opens the picker: exactly the two http candidates, as the add-on wrote them.
    await filmDetail.getByRole('button', { name: 'İzle', exact: true }).click()
    const picker = streamPicker(page)
    await expect(picker).toBeVisible()
    await expect(picker).toContainText(ADDON_KNOWN.film)
    await expect(streamCandidates(page)).toHaveCount(2)
    const [best, light] = ADDON_KNOWN.candidates
    await expect(streamCandidates(page).nth(0)).toContainText(best.name)
    await expect(streamCandidates(page).nth(0)).toContainText(best.detail)
    await expect(streamCandidates(page).nth(0)).toContainText(best.size)
    await expect(streamCandidates(page).nth(1)).toContainText(light.name)
    await expect(streamCandidates(page).nth(1)).toContainText(light.detail)
    for (const dropped of ADDON_KNOWN.droppedCandidates) await expect(picker).not.toContainText(dropped)
    await expect(picker.getByRole('heading', { name: ADDON_KNOWN.streamName, exact: true })).toBeVisible()
    await expect(picker).toContainText('2 yayın')
    await first.shot('stream-picker')
    await shotAtSmallestWindow(first, 'stream-picker-900x600')
    await expect(streamCandidates(page)).toHaveCount(2)
    await expectNoAddonSecrets(first, addons, 'picker with candidates')

    // Choosing one plays it, through the add-on's redirect to the file.
    await streamCandidates(page).nth(0).click()
    await expect(picker).toHaveCount(0)
    await expect(page).toHaveURL(/#\/player/)
    await waitForMpvProgress(page, { pathIncludes: addons.streamToken('film-1080'), advanceBy: 1, timeout: 45_000 })
    expect(addons.requests().some((request) => request.route === 'play'), 'the stream URL was opened').toBe(true)
    await page.evaluate((seconds) => window.electron!.mpvSeekTo(seconds), SEEK_TO)
    await expect.poll(async () => (await mpvState(page)).timePos, { timeout: 20_000 }).toBeGreaterThanOrEqual(SEEK_TO)
    await expect.poll(() => addonProgress(page, ADDON_KNOWN.filmId), { timeout: 25_000, intervals: [1000] }).toBeGreaterThanOrEqual(SEEK_TO - RESUME_TOLERANCE)
    await revealPlayerControls(page)
    await expect(page.getByRole('button', { name: 'Başka bir yayın seç', exact: true })).toBeVisible()
    await first.shot('player-dock')
    await expectNoAddonSecrets(first, addons, 'player')

    // Leaving: the honest mini player, and the position kept for "Kaldığın yerden".
    await leavePlayer(page)
    await expectSuspendedMiniPlayer(page, 'vod')
    await first.shot('mini-player')
    const saved = await addonProgress(page, ADDON_KNOWN.filmId)
    expect(saved, 'leaving kept the position').not.toBeNull()
    expect(saved!).toBeGreaterThanOrEqual(SEEK_TO - RESUME_TOLERANCE)
    await closeMiniPlayer(page)
    await backToFilmGrid(page)

    // A film the stream add-on has nothing for: said, not spun.
    await openFilmAndWatch(page, ADDON_KNOWN.filmNoStreams)
    await expect(picker).toContainText('Oynatılabilir bir yayın bulunamadı')
    await expect(picker).toContainText('Yayın bulamadı')
    await expect(streamCandidates(page)).toHaveCount(0)
    await expect(picker.locator('.animate-spin')).toHaveCount(0)
    await first.shot('stream-picker-empty')
    await closeStreamPicker(page)
    await backToFilmGrid(page)

    // The stream add-on is down: said, with a retry that works once it is back.
    addons.set('yayin', { down: true })
    await openFilmAndWatch(page, ADDON_KNOWN.filmOneStream)
    await expect(picker).toContainText('Eklentilerin hiçbiri yanıt vermedi')
    await expect(picker).toContainText('Yanıt vermedi.')
    await expect(picker.locator('.animate-spin')).toHaveCount(0)
    await first.shot('stream-picker-failed')
    addons.set('yayin', { down: false, latencyMs: 1500 })
    await picker.getByRole('button', { name: 'Tekrar Dene', exact: true }).click()
    await expect(picker).toContainText('Eklentilere soruluyor…')
    await expect(streamCandidates(page)).toHaveCount(1)
    await expect(picker).not.toContainText('Eklentilerin hiçbiri yanıt vermedi')
    addons.set('yayin', { latencyMs: 0 })
    await closeStreamPicker(page)
    await backToFilmGrid(page)

    // A film whose meta is missing: the detail shows what the card knows, and can still be played.
    await cardButton(page, ADDON_KNOWN.filmNoMeta).click()
    const bareDetail = page.getByRole('region', { name: ADDON_KNOWN.filmNoMeta, exact: true })
    await expect(bareDetail.getByRole('heading', { name: ADDON_KNOWN.filmNoMeta, exact: true })).toBeVisible()
    await expect(bareDetail.getByRole('button', { name: 'İzle', exact: true })).toBeVisible()
    expect(addons.requests().some((request) => request.route === 'meta' && request.status === 404)).toBe(true)
    await backToFilmGrid(page)

    // Home picks the film up where it was left.
    await openRoute(page, '/')
    await expect(continueTile(page)).toBeVisible()
    await expect(continueTile(page).getByRole('heading', { name: ADDON_KNOWN.film, exact: true })).toBeVisible()
    await first.shot('home-continue')

    // A series: seasons from the meta, specials last as "Özel bölümler".
    await openRoute(page, '/series')
    await cardButton(page, ADDON_KNOWN.series).click()
    const seriesDetail = page.getByRole('region', { name: 'Dizi ayrıntısı', exact: true })
    await expect(seriesDetail.getByRole('heading', { name: ADDON_KNOWN.series, exact: true })).toBeVisible()
    const seasons = seriesDetail.getByRole('region', { name: 'Sezonlar', exact: true })
    const episodes = seriesDetail.getByRole('region', { name: 'Bölümler', exact: true })
    await expect(seasons.getByRole('button')).toHaveText(['Sezon 1', 'Sezon 2', 'Özel bölümler'])
    await expect(seasons.getByRole('button', { name: 'Sezon 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const [firstTitle, secondTitle] = ADDON_KNOWN.seasonOne
    await expect(episodes.getByRole('button', { name: new RegExp(`^E1\\. ${firstTitle}`) })).toBeVisible()
    await expect(episodes.getByRole('button', { name: new RegExp(`^E3\\. ${ADDON_KNOWN.seasonOne[2]}`) })).toBeVisible()
    await first.shot('series-detail')
    await seasons.getByRole('button', { name: 'Özel bölümler', exact: true }).click()
    await expect(episodes.getByRole('button', { name: new RegExp(`^E1\\. ${ADDON_KNOWN.special}`) })).toBeVisible()
    await expect(episodes.getByRole('button')).toHaveCount(1)
    await seasons.getByRole('button', { name: 'Sezon 1', exact: true }).click()

    // The first episode through the picker.
    await episodes.getByRole('button', { name: new RegExp(`^E1\\. ${firstTitle}`) }).click()
    await expect(streamCandidates(page)).toHaveCount(1)
    await streamCandidates(page).first().click()
    await expect(page).toHaveURL(/#\/player/)
    await waitForMpvProgress(page, { pathIncludes: addons.streamToken('episode-1-1'), advanceBy: 1, timeout: 45_000 })
    await leavePlayer(page)
    await expect(page).toHaveURL(/#\/series/)
    await closeMiniPlayer(page)

    // The next one: same add-on, same binge group, so it plays without the picker.
    await expect(seriesDetail.getByRole('heading', { name: ADDON_KNOWN.series, exact: true })).toBeVisible()
    await watchForDialogs(page)
    await episodes.getByRole('button', { name: new RegExp(`^E2\\. ${secondTitle}`) }).click()
    await expect(page).toHaveURL(/#\/player/, { timeout: 20_000 })
    await waitForMpvProgress(page, { pathIncludes: addons.streamToken('episode-1-2'), advanceBy: 1, timeout: 45_000 })
    expect(await dialogOpenedSince(page), 'the picker stayed closed for the next episode').toBe(false)
    await leavePlayer(page)
    await closeMiniPlayer(page)

    await expectNoAddonSecrets(first, addons, 'end of the first run')
    observe(`first run: main-process output lines holding an add-on secret: ${mainLogLinesWithSecrets(first, addons)}`)
    const firstReport = await closeApp(first)
    expect(firstReport.exitedCleanly).toBe(true)
    expect(profileFilesHoldingSecrets(profileDir, addons), 'web storage on disk holds an add-on secret').toEqual([])

    // After a restart no stream URL is known: continuing asks again instead of failing.
    const second = await launch({ label: 'second' })
    const restarted = second.page
    await expect(continueTile(restarted)).toBeVisible({ timeout: 60_000 })
    await expect(continueTile(restarted).getByRole('heading', { name: ADDON_KNOWN.film, exact: true })).toBeVisible()
    await continueTile(restarted)
      .getByRole('button', { name: `${ADDON_KNOWN.film} — kaldığın yerden devam et`, exact: true })
      .click()
    await expect(streamPicker(restarted)).toBeVisible()
    await expect(streamCandidates(restarted)).toHaveCount(2)
    await expect(restarted.getByText('Seçilen içerik doğrudan oynatılamıyor.')).toHaveCount(0)
    await second.shot('restart-picker')
    await streamCandidates(restarted).nth(1).click()
    await expect(restarted).toHaveURL(/#\/player/)
    await waitForMpvProgress(restarted, { pathIncludes: addons.streamToken('film-720'), advanceBy: 1, timeout: 45_000 })
    // ... from where it was left.
    await expect.poll(async () => (await mpvState(restarted)).timePos, { timeout: 20_000 }).toBeGreaterThanOrEqual(saved! - RESUME_TOLERANCE)
    await second.shot('restart-playing')

    await expectNoAddonSecrets(second, addons, 'after the restart')
    observe(`second run: main-process output lines holding an add-on secret: ${mainLogLinesWithSecrets(second, addons)}`)
  })
})
