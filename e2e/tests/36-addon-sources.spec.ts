import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { ADDON_KNOWN } from '../mock-provider/addons.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { addXtreamSource, cardButton, expectHomeWithContent, openRoute } from '../support/flows.ts'
import { scrollGridTo } from '../support/catalog.ts'
import {
  addAddon,
  addonAddedStatus,
  addonChoice,
  addonField,
  addonFieldError,
  addonReview,
  addonSwitch,
  catalogEndLine,
  categoryList,
  checkAddonAddress,
  enableAddonSources,
  expectAddonHome,
  expectNoAddonSecrets,
  mainLogLinesWithSecrets,
  profileFilesHoldingSecrets,
  shotAtSmallestWindow
} from '../support/addons.ts'
import { observe } from '../support/known-bugs.ts'

// Add-on sources (Stremio add-on protocol) against the local fake add-ons of
// mock-provider/addons.ts: the experimental switch, adding and refusing
// add-ons, the source list, the add-on catalogue as categories loaded page by
// page, the pages an add-on has nothing for, and an Xtream source beside it.
// Playback is in 37-addon-playback.

/** Scrolls a catalog grid's scroll container as far down as it goes. */
async function scrollGridToEnd(page: Page, gridName: string): Promise<void> {
  await scrollGridTo(page, gridName, 10_000_000)
}

/** The sources list of Settings → Kaynaklar. */
function sourceList(page: Page) {
  return page.getByRole('region', { name: 'Kaynakların', exact: true })
}

/** One source's row in the list, by a text it holds (its name). */
function sourceRow(page: Page, name: string) {
  return sourceList(page).getByRole('listitem').filter({ hasText: name })
}

/** No spinner in the page's content: the state is said, not waited for. */
async function expectNoSpinner(page: Page): Promise<void> {
  await expect(page.getByRole('main').locator('.animate-spin')).toHaveCount(0)
}

test.describe('eklenti kaynakları', () => {
  test('deneysel anahtar, eklenti ekleme ve reddi, kaynak listesi, sayfa sayfa katalog, canlı TV yok', async ({
    launch,
    addons,
    profileDir,
    closeApp
  }) => {
    test.setTimeout(300_000)
    const app = await launch()
    const { page } = app
    await expect(page.getByRole('heading', { name: /Hoş Geldin/ })).toBeVisible()

    // Off by default: the add step offers Xtream and M3U only.
    await openRoute(page, '/settings')
    await expect(page.getByRole('button', { name: /^Xtream hesabım var/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^M3U listem var/ })).toBeVisible()
    await expect(addonChoice(page)).toHaveCount(0)
    await expect(addonSwitch(page)).not.toBeChecked()

    // Switched on in the same tab: the third choice appears.
    await addonSwitch(page).check()
    await expect(addonSwitch(page)).toBeChecked()
    await expect(addonChoice(page)).toBeVisible()
    await addonChoice(page).click()
    await expect(addonChoice(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(addonField(page)).toBeVisible()
    await app.shot('addon-form')

    // A wrong personal segment: the add-on answers 403, which is not a user name or password.
    await checkAddonAddress(page, addons.wrongSecretUrl)
    await expect(addonFieldError(page)).toContainText('Eklenti bu adresi kabul etmedi')
    await expect(addonFieldError(page)).not.toContainText('Kullanıcı adı')
    await expect(addonReview(page)).toHaveCount(0)
    expect(addons.requests().some((request) => request.route === 'refused'), 'the wrong address reached the add-on').toBe(true)
    await app.shot('addon-refused')

    // The right one: what was found is shown before anything is stored.
    await checkAddonAddress(page, addons.catalogUrl)
    const review = addonReview(page)
    await expect(review).toContainText(ADDON_KNOWN.catalogName)
    await expect(review).toContainText(`Sürüm ${ADDON_KNOWN.catalogVersion}`)
    await expect(review).toContainText(addons.host)
    await expect(review).toContainText('2 film kataloğu')
    await expect(review).toContainText('1 dizi kataloğu')
    await expect(review).not.toContainText('Film ve dizi yayınları')
    // The channel catalogue and the genre-only one are not shown, and it says so.
    await expect(review).toContainText('Bu eklentinin 2 kataloğu uygulamada henüz kullanılmıyor')
    await expect(review).toContainText('Bu eklenti yayın sağlamaz')
    await expect(review).not.toContainText(addons.secret)
    await expect(addonFieldError(page)).toHaveCount(0)
    await app.shot('addon-review')
    await shotAtSmallestWindow(app, 'addon-review-900x600')

    // The first source becomes the one in use, and home shows it.
    await page.getByRole('button', { name: 'Eklentiyi ekle', exact: true }).click()
    await expectAddonHome(page)
    await expect(page.getByRole('heading', { name: ADDON_KNOWN.popularFilm(1), exact: true })).toBeVisible({ timeout: 30_000 })
    await app.shot('addon-home')

    // The same add-on at the same address again: refused at the check.
    await openRoute(page, '/settings')
    await checkAddonAddress(page, addons.catalogUrl)
    await expect(addonFieldError(page)).toContainText(`Bu eklenti bu adresle zaten "${ADDON_KNOWN.catalogName}" olarak ekli`)
    await expect(addonReview(page)).toHaveCount(0)

    // The stream-only add-on: what it is for, and that it needs a catalogue.
    await checkAddonAddress(page, addons.streamUrl)
    await expect(review).toContainText(ADDON_KNOWN.streamName)
    await expect(review).toContainText('Film ve dizi yayınları')
    await expect(review).toContainText('Bu eklenti yalnızca yayın sağlar')
    await expect(review).not.toContainText('film kataloğu')
    await app.shot('addon-review-stream')
    await page.getByRole('button', { name: 'Eklentiyi ekle', exact: true }).click()
    await expect(addonAddedStatus(page, ADDON_KNOWN.streamName)).toBeVisible()
    await expect(page).toHaveURL(/#\/settings/)
    // The address is gone from its field once stored.
    await expect(addonField(page)).toHaveValue('')

    // Both in the list: the catalogue add-on in use, the stream add-on not choosable, saying why.
    await expect(sourceList(page)).toContainText('2 kaynak')
    const catalogRow = sourceRow(page, ADDON_KNOWN.catalogName)
    const streamRow = sourceRow(page, ADDON_KNOWN.streamName)
    await expect(catalogRow.getByRole('button', { name: /Kullanılıyor/ })).toBeVisible()
    await expect(catalogRow).toContainText(addons.host)
    await expect(catalogRow.getByRole('list', { name: 'Sağladıkları', exact: true })).toContainText('Film kataloğu')
    await expect(catalogRow.getByRole('list', { name: 'Sağladıkları', exact: true })).toContainText('Dizi kataloğu')
    await expect(streamRow).toContainText(addons.host)
    await expect(streamRow.getByRole('list', { name: 'Sağladıkları', exact: true })).toContainText('Yayın')
    await expect(streamRow).toContainText('Yalnızca yayın sağlar, bu yüzden kullanılan kaynak olamaz')
    await expect(streamRow).not.toContainText('Bu kaynağa geç')
    await expect(streamRow.getByRole('button', { name: /Kullanılıyor|Bu kaynağa geç|Yalnızca yayın sağlar/ })).toHaveCount(0)
    await expect(sourceList(page)).not.toContainText(addons.secret)
    await app.shot('sources-list')
    await expectNoAddonSecrets(app, addons, 'after adding both add-ons')

    // Filmler: the add-on's film catalogues are the categories; no "all", nothing of other types.
    addons.set('katalog', { failPagesAfterFirst: true })
    await openRoute(page, '/vod')
    const categories = categoryList(page)
    await expect(categories.getByRole('button', { name: ADDON_KNOWN.popularCatalog, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(categories.getByRole('button', { name: ADDON_KNOWN.shortCatalog, exact: true })).toBeVisible()
    await expect(categories.getByRole('button', { name: 'Tüm Filmler', exact: true })).toHaveCount(0)
    await expect(categories.getByRole('button', { name: ADDON_KNOWN.seriesCatalog, exact: true })).toHaveCount(0)
    for (const ignored of ADDON_KNOWN.ignoredCatalogs) {
      await expect(categories.getByRole('button', { name: ignored, exact: true })).toHaveCount(0)
    }
    await expect(cardButton(page, ADDON_KNOWN.popularFilm(1))).toBeVisible()
    await app.shot('films-addon')

    // The next page fails: a retry under the grid, no end line, no endless spinner.
    const pageFailed = page.getByRole('alert').filter({ hasText: 'Sonraki sayfa yüklenemedi' })
    await expect(async () => {
      await scrollGridToEnd(page, 'Filmler')
      await expect(pageFailed).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 30_000 })
    await expect(pageFailed.getByRole('button', { name: 'Tekrar Dene', exact: true })).toBeVisible()
    await expect(catalogEndLine(page)).toHaveCount(0)
    expect(addons.catalogSkips('populer')).toContain(ADDON_KNOWN.pageSize)
    await app.shot('films-next-page-failed')

    // The add-on recovers: the retry brings the page, scrolling the rest, then the end line.
    addons.set('katalog', { failPagesAfterFirst: false })
    await pageFailed.getByRole('button', { name: 'Tekrar Dene', exact: true }).click()
    await expect(async () => {
      await scrollGridToEnd(page, 'Filmler')
      await expect(catalogEndLine(page)).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 45_000 })
    await expect(pageFailed).toHaveCount(0)
    await scrollGridToEnd(page, 'Filmler')
    await expect(cardButton(page, ADDON_KNOWN.popularFilm(ADDON_KNOWN.popularCount))).toBeVisible()
    await app.shot('films-catalog-end')
    const skips = addons.catalogSkips('populer')
    observe(`popular catalogue pages asked (skip): ${skips.join(', ')}`)
    expect(skips).toContain(2 * ADDON_KNOWN.pageSize)
    expect(skips.filter((skip) => skip > 2 * ADDON_KNOWN.pageSize), 'nothing is asked past the short last page').toEqual([])

    // A catalogue without paging: one page, and it says it ended.
    await categories.getByRole('button', { name: ADDON_KNOWN.shortCatalog, exact: true }).click()
    await expect(categories.getByRole('button', { name: ADDON_KNOWN.shortCatalog, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(cardButton(page, ADDON_KNOWN.film)).toBeVisible()
    await expect(cardButton(page, ADDON_KNOWN.filmNoMeta)).toBeVisible()
    await expect(catalogEndLine(page)).toBeVisible()
    expect(addons.catalogSkips('kisa').filter((skip) => skip > 0)).toEqual([])

    // Diziler: the series catalogue.
    await openRoute(page, '/series')
    await expect(categoryList(page).getByRole('button', { name: ADDON_KNOWN.seriesCatalog, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(categoryList(page).getByRole('button', { name: 'Tüm Diziler', exact: true })).toHaveCount(0)
    await expect(cardButton(page, ADDON_KNOWN.series)).toBeVisible()

    // Canlı TV and Yayın Akışı: an add-on has neither, and the pages say so calmly.
    await openRoute(page, '/live')
    await expect(page.getByRole('heading', { name: 'Bu kaynakta canlı TV yok', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Filmlere göz at', exact: true })).toBeVisible()
    await expectNoSpinner(page)
    await app.shot('no-live-tv')
    await openRoute(page, '/epg')
    await expect(page.getByRole('heading', { name: 'Bu kaynakta canlı TV yok', exact: true })).toBeVisible()
    await expectNoSpinner(page)
    await app.shot('no-guide')

    await expectNoAddonSecrets(app, addons, 'end of the scenario')
    observe(`main-process output lines holding an add-on secret: ${mainLogLinesWithSecrets(app, addons)}`)
    await closeApp(app)
    expect(profileFilesHoldingSecrets(profileDir, addons), 'web storage on disk holds an add-on secret').toEqual([])
  })

  test('Xtream kaynağıyla yan yana: eklentiye geçiş ve Xtream kataloğuna geri dönüş', async ({ launch, mock, addons }) => {
    test.setTimeout(240_000)
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock, { name: 'Örnek Panel' })
    await expectHomeWithContent(page)

    // Added beside a source in use: the add-on does not take its place.
    await enableAddonSources(page)
    await addAddon(page, addons.catalogUrl, ADDON_KNOWN.catalogName)
    await expect(addonAddedStatus(page, ADDON_KNOWN.catalogName)).toBeVisible()
    await expect(addonField(page)).toHaveValue('')
    const xtreamRow = sourceRow(page, 'Örnek Panel')
    const addonRow = sourceRow(page, ADDON_KNOWN.catalogName)
    await expect(xtreamRow.getByRole('button', { name: /Kullanılıyor/ })).toBeVisible()
    await expect(addonRow.getByRole('button', { name: /Bu kaynağa geç/ })).toBeVisible()
    await app.shot('sources-xtream-and-addon')

    // The add-on in use: its catalogues on Filmler.
    await addonRow.getByRole('button', { name: /Bu kaynağa geç/ }).click()
    await expect(addonRow.getByRole('button', { name: /Kullanılıyor/ })).toBeVisible()
    await openRoute(page, '/vod')
    await expect(categoryList(page).getByRole('button', { name: ADDON_KNOWN.popularCatalog, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(categoryList(page).getByRole('button', { name: 'Tüm Filmler', exact: true })).toHaveCount(0)
    await expect(cardButton(page, ADDON_KNOWN.popularFilm(1))).toBeVisible()
    await openRoute(page, '/live')
    await expect(page.getByRole('heading', { name: 'Bu kaynakta canlı TV yok', exact: true })).toBeVisible()

    // Back to Xtream: its catalogue as before, nothing of the add-on's.
    await openRoute(page, '/settings')
    await xtreamRow.getByRole('button', { name: /Bu kaynağa geç/ }).click()
    await expect(xtreamRow.getByRole('button', { name: /Kullanılıyor/ })).toBeVisible()
    await openRoute(page, '/vod')
    await expect(categoryList(page).getByRole('button', { name: 'Tüm Filmler', exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(categoryList(page).getByRole('button', { name: ADDON_KNOWN.popularCatalog, exact: true })).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill('Kayıp Şehir')
    await expect(cardButton(page, KNOWN.film)).toBeVisible({ timeout: 60_000 })
    await openRoute(page, '/live')
    await expect(page.getByRole('button', { name: KNOWN.liveCategory, exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('heading', { name: 'Bu kaynakta canlı TV yok', exact: true })).toHaveCount(0)
    await app.shot('back-to-xtream-live')

    await expectNoAddonSecrets(app, addons, 'Xtream beside an add-on')
  })
})
