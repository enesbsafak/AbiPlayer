import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import type { AbiApp } from '../support/app.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import {
  addXtreamSource,
  anyCard,
  cardButton,
  closeMiniPlayer,
  expectHomeWithContent,
  leavePlayer,
  openRoute,
  waitForMpvProgress
} from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'

// Every inner page at the smallest window, the designed one and a large one,
// with a screenshot of each. Nothing may overflow sideways at 900 × 600, and
// in a large window the same-sized things are added rather than grown: the
// caps below are about 1.25 × the designed sizes.
//
// The window stays where test mode put it, off every display: resizing an
// off-screen window keeps it off-screen.

const SIZES = [
  { width: 900, height: 600 },
  { width: 1280, height: 800 },
  { width: 2560, height: 1440 }
]

/** 1.25 × the designed sizes (posters ~150–185 px wide, channel rows ~620 px). */
const CAP = { poster: 232, channelRow: 780 }

async function resizeWindow(app: AbiApp, width: number, height: number): Promise<void> {
  await app.electron.evaluate(({ BrowserWindow }, size) => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) throw new Error('the app has no window')
    window.setContentSize(size.width, size.height)
  }, { width, height })
  await expect
    .poll(() => app.page.evaluate(() => [window.innerWidth, window.innerHeight]))
    .toEqual([width, height])
  await app.page.waitForTimeout(300)
}

/** Nothing reaches past the window's right edge, and the page itself does not scroll sideways. */
async function expectNoSidewaysOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth
    const main = document.querySelector('main')
    const header = document.querySelector('header')
    return {
      document: document.documentElement.scrollWidth - width,
      main: main ? main.scrollWidth - main.clientWidth : 0,
      header: header ? header.scrollWidth - header.clientWidth : 0
    }
  })
  expect(overflow, `${label}: sideways overflow`).toEqual({ document: 0, main: 0, header: 0 })
}

/** Widths of the cards (their main buttons) in the grid of that name. */
async function cardWidths(page: Page, gridName: string): Promise<number[]> {
  return page
    .getByRole('group', { name: gridName, exact: true })
    .first()
    .evaluate((element) =>
      Array.from(element.querySelectorAll<HTMLElement>('[data-roving-index]')).map((card) => card.getBoundingClientRect().width)
    )
}

async function setHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = target
  }, hash)
}

test.describe('iç sayfaların pencere boyutları', () => {
  test('Canlı TV, Yayın Akışı, Filmler, diziler, Favoriler, Arama, Ayarlar ve oynatıcı her boyutta taşmadan durur', async ({ launch, mock }) => {
    test.setTimeout(420_000)
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)

    // A favourite channel and a favourite film, so Favoriler has both kinds.
    await openRoute(page, '/live')
    await page.getByRole('button', { name: KNOWN.liveCategory, exact: true }).click()
    const row = page.locator('div', { has: cardButton(page, KNOWN.liveChannels[0]) }).last()
    await row.getByRole('button', { name: 'Favorilere ekle' }).click()
    await openRoute(page, '/vod')
    await expect(anyCard(page)).toBeVisible()
    await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill('Kayıp Şehir')
    const filmCard = page.locator('div', { has: cardButton(page, KNOWN.film) }).last()
    await filmCard.getByRole('button', { name: 'Favorilere ekle' }).click()
    await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill('')

    for (const size of SIZES) {
      const tag = `${size.width}x${size.height}`
      await resizeWindow(app, size.width, size.height)

      // Canlı TV
      await openRoute(page, '/live')
      await page.getByRole('button', { name: 'Tüm Kanallar' }).click()
      await expect(anyCard(page)).toBeVisible()
      await app.shot(`live-${tag}`)
      await expectNoSidewaysOverflow(page, `${tag} Canlı TV`)
      for (const width of await cardWidths(page, 'Kanallar')) expect(width, `${tag} channel row`).toBeLessThanOrEqual(CAP.channelRow)

      // Yayın Akışı
      await openRoute(page, '/epg')
      await expect(page.getByText('Yayın akışı yükleniyor…')).toHaveCount(0, { timeout: 60_000 })
      await page.waitForTimeout(500)
      await app.shot(`epg-${tag}`)
      await expectNoSidewaysOverflow(page, `${tag} Yayın Akışı`)

      // Filmler: the grid, then a film's detail
      await openRoute(page, '/vod')
      await page.getByRole('button', { name: 'Tüm Filmler', exact: true }).click()
      await expect(anyCard(page)).toBeVisible()
      await page.waitForTimeout(300)
      await app.shot(`vod-${tag}`)
      await expectNoSidewaysOverflow(page, `${tag} Filmler`)
      for (const width of await cardWidths(page, 'Filmler')) expect(width, `${tag} poster`).toBeLessThanOrEqual(CAP.poster)
      await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill('Kayıp Şehir')
      await cardButton(page, KNOWN.film).click()
      await expect(page.getByRole('button', { name: 'İzle', exact: true })).toBeVisible()
      // Under the detail, a row of the category's other films fills the width.
      const more = page.getByRole('region', { name: 'Aynı kategoriden' })
      await expect(more.getByRole('button', { name: / oynat$/ }).first()).toBeVisible()
      await page.waitForTimeout(300)
      await app.shot(`vod-detail-${tag}`)
      await expectNoSidewaysOverflow(page, `${tag} film detail`)
      const moreWidths = await more.evaluate((element) =>
        Array.from(element.querySelectorAll<HTMLElement>('button[aria-label$=" oynat"]')).map((card) => card.getBoundingClientRect().width)
      )
      expect(moreWidths.length, `${tag} films in the row`).toBeGreaterThanOrEqual(3)
      for (const width of moreWidths) expect(width, `${tag} related poster`).toBeLessThanOrEqual(CAP.poster)
      await page.getByRole('button', { name: 'Geri', exact: true }).click()
      await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill('')

      // A series' detail
      await openRoute(page, '/series')
      await page.getByRole('textbox', { name: 'Dizi ara', exact: true }).fill('Sessiz Liman')
      await cardButton(page, KNOWN.series).click()
      await expect(page.getByRole('button', { name: /^E1\. / }).first()).toBeVisible()
      await page.waitForTimeout(300)
      await app.shot(`series-detail-${tag}`)
      await expectNoSidewaysOverflow(page, `${tag} series detail`)
      await page.getByRole('button', { name: 'Geri', exact: true }).click()
      await page.getByRole('textbox', { name: 'Dizi ara', exact: true }).fill('')

      // Favoriler
      await openRoute(page, '/favorites')
      await expect(cardButton(page, KNOWN.liveChannels[0])).toBeVisible()
      await app.shot(`favorites-${tag}`)
      await expectNoSidewaysOverflow(page, `${tag} Favoriler`)

      // Arama, with results of every kind
      await openRoute(page, '/search')
      await page.getByPlaceholder('Tüm kanal, film ve dizilerde ara...').fill('TR')
      await expect(page.getByRole('region', { name: 'Arama sonuçları' })).toBeVisible()
      await page.waitForTimeout(500)
      await app.shot(`search-${tag}`)
      await expectNoSidewaysOverflow(page, `${tag} Arama`)

      // Ayarlar: Kaynaklar with one source, and Katalog (many rows)
      await setHash(page, '#/settings?tab=sources')
      await expect(page.locator('#xtream-url')).toBeVisible()
      await app.shot(`settings-sources-${tag}`)
      await expectNoSidewaysOverflow(page, `${tag} Ayarlar → Kaynaklar`)
      await setHash(page, '#/settings?tab=catalog')
      await page.waitForTimeout(500)
      await app.shot(`settings-catalog-${tag}`)
      await expectNoSidewaysOverflow(page, `${tag} Ayarlar → Katalog`)

      // The player, with its dock up
      await openRoute(page, '/live')
      await page.getByRole('button', { name: KNOWN.liveCategory, exact: true }).click()
      await cardButton(page, KNOWN.liveChannels[1]).click()
      await expect(page).toHaveURL(/#\/player/)
      await waitForMpvProgress(page, { advanceBy: 1, timeout: 45_000 })
      await page.mouse.move(size.width / 2, size.height / 2)
      await page.mouse.move(size.width / 2 + 10, size.height / 2 + 10)
      await page.waitForTimeout(400)
      await app.shot(`player-${tag}`)
      await expectNoSidewaysOverflow(page, `${tag} player`)
      await leavePlayer(page)
      await closeMiniPlayer(page)
      observe(`${tag}: every inner page drawn`)
    }

    expect((await app.windowPlacement()).onAnyDisplay).toBe(false)
  })
})
