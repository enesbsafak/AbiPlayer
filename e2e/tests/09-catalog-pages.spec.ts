import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import type { MockProvider } from '../mock-provider/server.ts'
import { addXtreamSource, anyCard, cardButton, closeMiniPlayer, expectHomeWithContent, leavePlayer, openRoute } from '../support/flows.ts'
import { focusedName, grid, gridScrollTop, renderedCardNames, scrollGridTo } from '../support/catalog.ts'
import { defined } from '../../src/shared/checked.ts'

async function signIn(page: Page, mock: MockProvider) {
  await addXtreamSource(page, mock)
  await expectHomeWithContent(page)
}

/** The full list is in: no preview banner any more, so the grid no longer changes under the test. */
async function waitForFullList(page: Page) {
  await expect(page.getByText(/Ön izleme listesi gösteriliyor|ön izleme listesiyle açılıyor/)).toHaveCount(0, { timeout: 60_000 })
}

/** Name of the first card wholly inside the grid's scroll viewport. */
async function firstCardInView(page: Page, gridName: string): Promise<string> {
  const name = await grid(page, gridName).evaluate((element) => {
    let scroller = element.parentElement
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    const view = scroller!.getBoundingClientRect()
    for (const card of Array.from(element.querySelectorAll<HTMLElement>('[data-roving-index]'))) {
      const box = card.getBoundingClientRect()
      if (box.top >= view.top && box.bottom <= view.bottom) return card.getAttribute('aria-label')
    }
    return null
  })
  if (!name) throw new Error(`no card of "${gridName}" is in view`)
  return name
}

/** Distance of a card's top edge from the top of the grid's scroll viewport, px. */
async function cardOffsetInView(page: Page, gridName: string, cardName: string): Promise<number> {
  return grid(page, gridName).evaluate((element, cardName) => {
    let scroller = element.parentElement
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    const card = Array.from(element.querySelectorAll<HTMLElement>('[data-roving-index]')).find(
      (candidate) => candidate.getAttribute('aria-label') === cardName
    )
    if (!card || !scroller) return Number.NaN
    return Math.round(card.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
  }, cardName)
}

/** The focused element is inside the open detail view. */
async function focusIsInDetail(page: Page, label: string): Promise<boolean> {
  return page.evaluate((label) => {
    const region = document.activeElement?.closest('[role="region"]')
    return region?.getAttribute('aria-label') === label
  }, label)
}

test.describe('katalog sayfaları', () => {
  test('F1-40: film ayrıntısı ızgarayı korur; geri ve oynatıcıdan dönüş kaydırmayı ve odağı geri getirir', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await signIn(page, mock)
    await openRoute(page, '/vod')
    await expect(anyCard(page)).toBeVisible()
    await waitForFullList(page)

    const top = await scrollGridTo(page, 'Filmler', 2400)
    expect(top, 'the film grid scrolls').toBeGreaterThan(1500)
    const cardName = await firstCardInView(page, 'Filmler')
    const filmName = cardName.replace(/ oynat$/, '')

    // Open and close with the keyboard: the grid stayed mounted underneath.
    await page.getByRole('button', { name: cardName, exact: true }).click()
    await expect(page.getByRole('button', { name: 'İzle', exact: true })).toBeVisible()
    await expect(grid(page, 'Filmler')).toBeHidden()
    expect(await focusIsInDetail(page, filmName), 'focus moved into the detail').toBe(true)
    await app.shot('film-detail-overlay')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'İzle', exact: true })).toHaveCount(0)
    await expect.poll(async () => Math.abs((await gridScrollTop(page, 'Filmler')) - top)).toBeLessThan(2)
    await expect.poll(() => focusedName(page)).toBe(cardName)
    const cardTop = await cardOffsetInView(page, 'Filmler', cardName)

    // Play from the detail and come back from the player: same detail, then the same place.
    await page.getByRole('button', { name: cardName, exact: true }).click()
    await page.getByRole('button', { name: 'İzle', exact: true }).click()
    await expect(page).toHaveURL(/#\/player/)
    await leavePlayer(page)
    await expect(page).toHaveURL(/#\/vod/)
    await expect(page.getByRole('heading', { name: filmName })).toBeVisible()
    await app.shot('film-detail-after-player')
    await page.getByRole('button', { name: 'Geri', exact: true }).click()
    await expect.poll(() => focusedName(page)).toBe(cardName)
    // The page was mounted again and its rows measured again, which may
    // settle a few pixels apart: the card is where it was on screen.
    const restoredTop = await cardOffsetInView(page, 'Filmler', cardName)
    expect(Math.abs(restoredTop - cardTop), `card at ${restoredTop}px, was at ${cardTop}px`).toBeLessThanOrEqual(8)
    expect(Math.abs((await gridScrollTop(page, 'Filmler')) - top)).toBeLessThanOrEqual(8)
    await closeMiniPlayer(page)
  })

  test('F5-01: ok tuşlarıyla ızgarada gezinme, Enter ile ayrıntı, Backspace ile geri', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await signIn(page, mock)
    await openRoute(page, '/series')
    await expect(anyCard(page)).toBeVisible()
    await waitForFullList(page)

    // One tab stop: from the search box straight into the grid.
    await page.getByRole('textbox', { name: 'Dizi ara', exact: true }).click()
    await page.keyboard.press('Tab')
    const names = await renderedCardNames(page, 'Diziler')
    expect(await focusedName(page)).toBe(names[0])

    await page.keyboard.press('ArrowRight')
    expect(await focusedName(page)).toBe(names[1])
    const second = (await page.getByRole('button', { name: names[1], exact: true }).boundingBox())!

    await page.keyboard.press('ArrowDown')
    const below = (await focusedName(page))!
    const belowBox = (await page.getByRole('button', { name: below, exact: true }).boundingBox())!
    expect(Math.abs(belowBox.x - second.x), 'down keeps the column').toBeLessThan(2)
    expect(belowBox.y).toBeGreaterThan(second.y)
    await app.shot('grid-keyboard-focus')

    // Enter opens the detail and moves the focus into it.
    await page.keyboard.press('Enter')
    const seriesName = below.replace(/ oynat$/, '')
    await expect(page.getByRole('heading', { name: seriesName })).toBeVisible()
    expect(await focusIsInDetail(page, 'Dizi ayrıntısı')).toBe(true)

    // Backspace goes back and returns the focus to the card that opened it.
    await page.keyboard.press('Backspace')
    await expect(page.getByRole('heading', { name: seriesName })).toHaveCount(0)
    await expect.poll(() => focusedName(page)).toBe(below)

    // The keys stay with the grid: nothing outside the player claims them.
    await page.keyboard.press('ArrowUp')
    expect(await focusedName(page)).toBe(names[1])
  })

  test('F1-26: tam film listesi alınamayınca hata şeridi ve "Tekrar Dene"; sağlayıcı düzelince liste tamamlanır', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    // Only the whole-catalog request fails; previews ask per category and pass.
    const fullFilmList = (url: URL) => url.searchParams.get('action') === 'get_vod_streams' && !url.searchParams.has('category_id')
    let failedRequests = 0
    await page.route(fullFilmList, async (route) => {
      failedRequests += 1
      await route.fulfill({
        status: 500,
        contentType: 'text/plain; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: 'Mock failure 500'
      })
    })
    await signIn(page, mock)
    await openRoute(page, '/vod')

    const banner = page.getByRole('alert').filter({ hasText: 'Tam film listesi yüklenemedi' })
    await expect(banner).toBeVisible({ timeout: 45_000 })
    await expect(banner.getByRole('button', { name: 'Tekrar Dene' })).toBeVisible()
    // The calm "loading in the background" banner is gone after the failure.
    await expect(page.getByText(/arka planda yükleniyor/)).toHaveCount(0)
    expect(failedRequests).toBeGreaterThan(0)
    await app.shot('full-sync-failed')

    const lastFilm = String(defined(mock.catalog.vod.at(-1), 'the last film').name)
    await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill(lastFilm)
    await expect(page.getByText(/^0 sonuç/)).toBeVisible()
    await expect(cardButton(page, lastFilm)).toHaveCount(0)

    // The provider recovers; the retry fetches the whole list.
    await page.unroute(fullFilmList)
    await banner.getByRole('button', { name: 'Tekrar Dene' }).click()
    await expect(banner).toHaveCount(0, { timeout: 30_000 })
    await expect(cardButton(page, lastFilm).first()).toBeVisible()
    await expect(page.getByText(/arka planda yükleniyor/)).toHaveCount(0)
    await app.shot('full-sync-recovered')
  })
})
