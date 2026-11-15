import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import type { MockProvider } from '../mock-provider/server.ts'
import { addXtreamSource, anyCard, cardButton, expectHomeWithContent, openRoute } from '../support/flows.ts'
import { knownBug, observe } from '../support/known-bugs.ts'

/** A live category other than the first, and the first channel in it. */
function secondLiveCategory(mock: MockProvider) {
  const category = mock.catalog.liveCategories[1]
  const id = String(category.category_id)
  const index = mock.catalog.liveCategoryOf.findIndex((categoryId) => categoryId === id)
  return { name: category.category_name, firstChannel: String(mock.catalog.live[index].name) }
}

async function signIn(page: Page, mock: MockProvider) {
  await addXtreamSource(page, mock)
  await expectHomeWithContent(page)
}

test.describe('katalog gezintisi', () => {
  test('Canlı TV, Filmler ve Diziler: kategori seçimi, arama, dizi ayrıntısı', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await signIn(page, mock)

    // Live TV: category, then search.
    await openRoute(page, '/live')
    await expect(anyCard(page)).toBeVisible()
    const category = secondLiveCategory(mock)
    await page.getByRole('button', { name: category.name, exact: true }).click()
    await expect(cardButton(page, category.firstChannel)).toBeVisible()
    await app.shot('live-category')
    await page.getByRole('button', { name: 'Tüm Kanallar' }).click()
    await page.getByPlaceholder('Kanal ara...').fill('Show TV')
    await expect(cardButton(page, KNOWN.liveChannels[1])).toBeVisible()
    await expect(cardButton(page, KNOWN.liveChannels[0])).toHaveCount(0)
    await app.shot('live-search')

    // Films: the first category holds the known titles.
    await openRoute(page, '/vod')
    await page.getByRole('button', { name: 'Tüm Filmler' }).click()
    await page.getByRole('button', { name: KNOWN.vodCategory, exact: true }).click()
    await expect(cardButton(page, KNOWN.film)).toBeVisible()
    await page.getByPlaceholder('Kanal ara...').fill('Çift Dilli')
    await expect(cardButton(page, KNOWN.dualAudioFilm)).toBeVisible()
    await app.shot('vod-search')
    await cardButton(page, KNOWN.dualAudioFilm).click()
    await expect(page.getByRole('button', { name: 'Filmi Oynat' })).toBeVisible()
    await app.shot('vod-detail')

    // Series: open the detail, switch season.
    await openRoute(page, '/series')
    await page.getByRole('button', { name: 'Tüm Diziler' }).click()
    await page.getByPlaceholder('Kanal ara...').fill('Sessiz Liman')
    await cardButton(page, KNOWN.series).click()
    await expect(page.getByRole('heading', { name: KNOWN.series })).toBeVisible()
    await expect(page.getByRole('button', { name: /^E1\. / })).toBeVisible()
    await app.shot('series-detail')
    const seriesInfoBefore = mock.stats().counts.get_series_info ?? 0
    const seasonTwo = page.getByRole('button', { name: 'Sezon 2', exact: true })
    if (await seasonTwo.count()) {
      await seasonTwo.click()
      await expect(page.getByRole('button', { name: /^E1\. .*S02E01/ })).toBeVisible()
      await page.waitForTimeout(1000)
      observe(`F1-23: get_series_info requests caused by one season click: ${(mock.stats().counts.get_series_info ?? 0) - seriesInfoBefore}`)
    }

    // Global search across all types.
    await openRoute(page, '/search')
    await page.getByPlaceholder('Tüm kanal, film ve dizilerde ara...').fill('Kayıp Şehir')
    await expect(page.getByText(KNOWN.film).first()).toBeVisible()
    await app.shot('global-search')
  })

  test('F1-20: Canlı TV kategorisi seçiliyken Filmler sayfası dolu gelir', async ({ launch, mock }) => {
    knownBug('F1-20', 'Canlı TV\'de seçilen kategori Filmler ve Diziler\'e sızıyor, liste boş')
    const app = await launch()
    const { page } = app
    await signIn(page, mock)
    await openRoute(page, '/live')
    await page.getByRole('button', { name: secondLiveCategory(mock).name, exact: true }).click()
    await openRoute(page, '/vod')
    await page.waitForTimeout(1500)
    await app.shot('vod-after-live-category')
    await expect(page.getByRole('button', { name: / oynat$/ }).first()).toBeVisible({ timeout: 5000 })
  })

  test('F1-21: kanal kartındaki favori yıldızı tıklanınca güncellenir', async ({ launch, mock }) => {
    knownBug('F1-21', 'Kanal kartında favori yıldızı güncellenmiyor')
    const app = await launch()
    const { page } = app
    await signIn(page, mock)
    await openRoute(page, '/live')
    await page.getByRole('button', { name: KNOWN.liveCategory, exact: true }).click()
    const card = page.locator('div', { has: cardButton(page, KNOWN.liveChannels[0]) }).last()
    await card.getByRole('button', { name: 'Favorilere ekle' }).click()
    await app.shot('after-star')
    await expect(card.getByRole('button', { name: 'Favorilerden çıkar' })).toBeVisible({ timeout: 3000 })
  })
})
