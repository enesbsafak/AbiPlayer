import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { ADDON_KNOWN } from '../mock-provider/addons.ts'
import { MOCK_TMDB_KEY, TMDB_KNOWN } from '../mock-provider/tmdb.ts'
import { cardButton, closeMiniPlayer, leavePlayer, openRoute, waitForMpvProgress } from '../support/flows.ts'
import { grid, scrollGridTo } from '../support/catalog.ts'
import { routeMockTmdb } from '../support/tmdb.ts'
import {
  addAddon,
  addonAddedStatus,
  catalogEndLine,
  categoryList,
  enableAddonSources,
  streamCandidates,
  streamPicker
} from '../support/addons.ts'

// The built-in TMDB catalogue against the fake TMDB of mock-provider/tmdb.ts
// (answered through request routing: the real TMDB is never contacted) and
// the fake stream add-on of mock-provider/addons.ts: adding it once a TMDB
// key is saved, its catalogues as categories paged past the first page,
// the search box asking TMDB, a film's and a series' detail in Turkish, a
// title TMDB has no IMDb id for, and a film played through the stream
// add-on's candidates.

const ATTRIBUTION = "Film ve dizi bilgileri TMDB'den alınır"
const NO_IMDB = "TMDB'de bu başlığın IMDb kimliği yok."

/** The sources list of Settings → Kaynaklar. */
function sourceList(page: Page) {
  return page.getByRole('region', { name: 'Kaynakların', exact: true })
}

/** From a film's detail back to the Filmler grid. */
async function closeDetail(page: Page): Promise<void> {
  const back = page.getByRole('button', { name: 'Geri', exact: true })
  if (await back.isVisible()) await back.click()
  await expect(grid(page, 'Filmler')).toBeVisible()
}

test.describe('TMDB Kataloğu', () => {
  test('anahtarla ekleme, sayfalı katalog, TMDB araması, film ve dizi ayrıntısı, yayın eklentisinden oynatma', async ({ launch, addons }) => {
    test.setTimeout(420_000)
    const app = await launch()
    const { page } = app
    const tmdb = await routeMockTmdb(page)
    await enableAddonSources(page)

    // Without a key the catalogue cannot be added: it says so and leads to the key's field.
    await expect(page.getByText('TMDB Kataloğu', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kataloğu ekle', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Anahtarı gir', exact: true }).click()
    await expect(page).toHaveURL(/tab=general/)
    const keyField = page.locator('#tmdb-api-key')
    await expect(keyField).toBeFocused()
    await keyField.fill(MOCK_TMDB_KEY)
    await keyField.press('Enter')
    await expect(page.getByText('Anahtar güvenli depoya kaydedildi.', { exact: true })).toBeVisible()

    // With the key: added, the first source, so it is the one in use and the app goes home.
    await openRoute(page, '/settings')
    await page.getByRole('button', { name: 'Kataloğu ekle', exact: true }).click()
    await expect(page).toHaveURL(/(#\/|index\.html(\?[^#]*)?)$/, { timeout: 30_000 })
    const tiles = page.getByRole('navigation', { name: 'Ana gezinme' })
    await expect(tiles.getByRole('link', { name: new RegExp(`^Filmler ${TMDB_KNOWN.filmCatalogCount} katalog`) })).toBeVisible({
      timeout: 30_000
    })
    await expect(tiles.getByRole('link', { name: new RegExp(`^Diziler ${TMDB_KNOWN.seriesCatalogCount} katalog`) })).toBeVisible()
    expect(tmdb.requests().some((request) => request.path === '/genre/movie/list' && request.query['language'] === 'tr-TR')).toBe(true)

    // The stream add-on that plays what the catalogue lists.
    await openRoute(page, '/settings')
    await addAddon(page, addons.streamUrl, ADDON_KNOWN.streamName)
    await expect(addonAddedStatus(page, ADDON_KNOWN.streamName)).toBeVisible()
    const tmdbRow = sourceList(page).getByRole('listitem').filter({ hasText: 'TMDB Kataloğu' })
    await expect(tmdbRow).toContainText('Yerleşik katalog')
    await expect(tmdbRow).toContainText(ATTRIBUTION)
    await expect(tmdbRow.getByRole('img', { name: 'TMDB' })).toBeVisible()
    await expect(tmdbRow.getByRole('button', { name: /Kullanılıyor/ })).toBeVisible()
    await expect(tmdbRow.getByRole('button', { name: 'Adresi Gir', exact: true })).toHaveCount(0)
    await app.shot('tmdb-source-row')

    // Filmler: the fixed catalogues, then TMDB's genres; the credit under them.
    await openRoute(page, '/vod')
    const categories = categoryList(page)
    await expect(categories.getByRole('button', { name: 'Bu hafta trend', exact: true })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Popüler', 'Vizyondakiler', 'Yakında', 'En yüksek puanlı', ...TMDB_KNOWN.movieGenres]) {
      await expect(categories.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(categories.getByRole('button', { name: 'Arama', exact: true })).toHaveCount(0)
    await expect(page.getByText(ATTRIBUTION)).toBeVisible()
    await expect(cardButton(page, TMDB_KNOWN.film)).toBeVisible({ timeout: 30_000 })

    // "Popüler" past its first page, to its end (three TMDB pages).
    await categories.getByRole('button', { name: 'Popüler', exact: true }).click()
    await expect(cardButton(page, TMDB_KNOWN.popularFilm(3))).toBeVisible({ timeout: 30_000 })
    await app.shot('tmdb-films')
    await expect(async () => {
      await scrollGridTo(page, 'Filmler', 10_000_000)
      await expect(catalogEndLine(page)).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 45_000 })
    await scrollGridTo(page, 'Filmler', 10_000_000)
    await expect(cardButton(page, TMDB_KNOWN.popularFilm(TMDB_KNOWN.popularCount))).toBeVisible()
    expect(tmdb.pagesAsked('/movie/popular')).toEqual([1, 2, 3])
    expect(tmdb.requests().find((request) => request.path === '/movie/popular')?.query).toMatchObject({ language: 'tr-TR', region: 'TR' })

    // The search box asks TMDB (it does not only filter what is loaded).
    const searchBox = page.getByRole('textbox', { name: 'Film ara', exact: true })
    await searchBox.fill(TMDB_KNOWN.filmQuery)
    await expect(cardButton(page, TMDB_KNOWN.film)).toBeVisible({ timeout: 20_000 })
    await expect(cardButton(page, TMDB_KNOWN.popularFilm(3))).toHaveCount(0)
    await expect(page.getByText('1 sonuç', { exact: true })).toBeVisible()
    await expect(page.getByText(/şimdiye kadar yüklenen/)).toHaveCount(0)
    const searches = tmdb.requests().filter((request) => request.path === '/search/movie')
    expect(searches.map((request) => request.query['query'])).toEqual([TMDB_KNOWN.filmQuery])
    expect(searches[0]?.query).toMatchObject({ include_adult: 'false', language: 'tr-TR' })
    await app.shot('tmdb-search')

    // The film's detail in Turkish, from TMDB.
    await cardButton(page, TMDB_KNOWN.film).click()
    const filmDetail = page.getByRole('region', { name: TMDB_KNOWN.film, exact: true })
    await expect(filmDetail.getByRole('heading', { name: TMDB_KNOWN.film, exact: true })).toBeVisible()
    await expect(filmDetail).toContainText(TMDB_KNOWN.filmPlot)
    await expect(filmDetail).toContainText(TMDB_KNOWN.filmRuntime)
    await expect(filmDetail).toContainText(`Yönetmen: ${TMDB_KNOWN.filmDirector}`)
    await expect(filmDetail).toContainText(`Oyuncular: ${TMDB_KNOWN.filmCast}`)
    expect(tmdb.requests().some((request) => request.path === `/movie/${TMDB_KNOWN.filmId}`)).toBe(true)
    await app.shot('tmdb-film-detail')

    // "İzle": the stream add-on is asked by the film's IMDb id; one candidate plays.
    await filmDetail.getByRole('button', { name: 'İzle', exact: true }).click()
    await expect(streamPicker(page)).toBeVisible()
    await expect(streamCandidates(page)).toHaveCount(2)
    expect(addons.requests().some((request) => request.route === 'stream' && request.id === ADDON_KNOWN.filmId)).toBe(true)
    await app.shot('tmdb-stream-picker')
    await streamCandidates(page).first().click()
    await expect(page).toHaveURL(/#\/player/)
    await waitForMpvProgress(page, { pathIncludes: addons.streamToken('film-1080'), advanceBy: 1, timeout: 45_000 })
    await leavePlayer(page)
    await closeMiniPlayer(page)
    await closeDetail(page)

    // A title TMDB has no IMDb id for: its detail opens, and "İzle" says why nothing can be asked.
    await searchBox.fill('kayıtsız')
    await cardButton(page, TMDB_KNOWN.filmWithoutImdb).click()
    const bareDetail = page.getByRole('region', { name: TMDB_KNOWN.filmWithoutImdb, exact: true })
    await expect(bareDetail.getByRole('heading', { name: TMDB_KNOWN.filmWithoutImdb, exact: true })).toBeVisible()
    await bareDetail.getByRole('button', { name: 'İzle', exact: true }).click()
    await expect(bareDetail.getByRole('status').filter({ hasText: NO_IMDB })).toBeVisible()
    await expect(streamPicker(page)).toHaveCount(0)
    await app.shot('tmdb-film-no-imdb')
    await closeDetail(page)

    // A series: its seasons at once, a season's episodes when it is opened.
    await openRoute(page, '/series')
    await expect(categoryList(page).getByRole('button', { name: 'Bu hafta trend', exact: true })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Popüler', 'Yayında', 'En yüksek puanlı', ...TMDB_KNOWN.seriesGenres]) {
      await expect(categoryList(page).getByRole('button', { name, exact: true })).toBeVisible()
    }
    await cardButton(page, TMDB_KNOWN.series).click()
    const seriesDetail = page.getByRole('region', { name: 'Dizi ayrıntısı', exact: true })
    await expect(seriesDetail.getByRole('heading', { name: TMDB_KNOWN.series, exact: true })).toBeVisible()
    // The Turkish overview is empty: the original language's text instead.
    await expect(seriesDetail).toContainText('Sisli bir vadide kaybolan bir köyün izini süren iki kardeş.')
    const seasons = seriesDetail.getByRole('region', { name: 'Sezonlar', exact: true })
    const episodes = seriesDetail.getByRole('region', { name: 'Bölümler', exact: true })
    await expect(seasons.getByRole('button')).toHaveText(['Sezon 1', 'Sezon 2', 'Özel bölümler'])
    await expect(seasons.getByRole('button', { name: 'Sezon 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(episodes.getByRole('button', { name: new RegExp(`^E1\\. ${TMDB_KNOWN.seasonOne[0]}`) })).toBeVisible()
    await expect(episodes.getByRole('button')).toHaveCount(TMDB_KNOWN.seasonOne.length)
    await expect(episodes).toContainText('Yayın: ')
    const seasonPaths = () => tmdb.requests().filter((request) => request.path.startsWith(`/tv/${TMDB_KNOWN.seriesId}/season/`)).map((r) => r.path)
    expect(seasonPaths()).toEqual([`/tv/${TMDB_KNOWN.seriesId}/season/1`])
    await app.shot('tmdb-series-season')
    await seasons.getByRole('button', { name: 'Sezon 2', exact: true }).click()
    await expect(episodes.getByRole('button', { name: new RegExp(`^E1\\. ${TMDB_KNOWN.seasonTwo[0]}`) })).toBeVisible()
    expect(seasonPaths()).toEqual([`/tv/${TMDB_KNOWN.seriesId}/season/1`, `/tv/${TMDB_KNOWN.seriesId}/season/2`])

    // Home with the catalogue in use: its catalogues as tiles, and the film (to
    // continue, or the first of "Bu hafta trend") in the large tile.
    await openRoute(page, '/')
    await expect(tiles.getByRole('link', { name: new RegExp(`^Filmler ${TMDB_KNOWN.filmCatalogCount} katalog`) })).toBeVisible()
    await expect(tiles.getByRole('link', { name: /^Canlı TV Bu kaynakta canlı TV yok/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: TMDB_KNOWN.film, exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await app.shot('tmdb-home')

    // The key never reaches the stored state.
    const stored = await page.evaluate(() => Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? '').join('\n'))
    expect(stored).not.toContain(MOCK_TMDB_KEY)
  })
})
