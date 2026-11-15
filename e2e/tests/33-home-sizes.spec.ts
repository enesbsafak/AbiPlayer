import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import type { AbiApp } from '../support/app.ts'
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
  waitForMpvProgress
} from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'

// The home screen across window sizes. It was designed for 1280 × 800. A
// bigger window must get more content (more columns in the tile block, more
// posters, more rows), never tiles much bigger than designed or empty bands;
// the smallest window (900 × 600) must not overflow. Each size leaves a
// screenshot in this test's output folder.
//
// The window stays where test mode put it, off every display: resizing an
// off-screen window keeps it off-screen.

/** The design at 1280 × 800, and the most anything may grow (1.25 ×). */
const DESIGN = { feature: { width: 606, height: 430 }, tile: { width: 293, height: 205 }, tileTitle: 44 }
const GROWTH = 1.25
/** The gap above a row (24 px), doubled at most to take up spare height. */
const MAX_GAP = 48

const SIZES = [
  { width: 900, height: 600 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3440, height: 1440 }
]

async function resizeWindow(app: AbiApp, width: number, height: number): Promise<void> {
  await app.electron.evaluate(({ BrowserWindow }, size) => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) throw new Error('the app has no window')
    window.setContentSize(size.width, size.height)
  }, { width, height })
  await expect
    .poll(() => app.page.evaluate(() => [window.innerWidth, window.innerHeight]))
    .toEqual([width, height])
  // Let the measured layout (rows that fit, posters that fit) settle.
  await app.page.waitForTimeout(400)
}

interface Box {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

/** Boxes of home's parts, read in one go. */
async function homeLayout(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null | undefined): Box | null => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
    }
    const nav = document.querySelector('nav[aria-label="Ana gezinme"]')
    const block = nav?.parentElement
    const stage = block?.parentElement
    const main = document.querySelector('main')
    const banner = document.querySelector('header')
    const close = document.querySelector('button[aria-label="Pencereyi kapat"]')
    const panel = document.querySelector('section[aria-labelledby="home-channels"]')
    const rows = Array.from(document.querySelectorAll('section[aria-labelledby^="home-row-"]')).map((row) => ({
      title: row.querySelector('h2')?.textContent ?? '',
      box: box(row)!,
      lastItem: box(row.querySelector('button:last-of-type'))
    }))
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      block: box(block),
      feature: box(block?.firstElementChild),
      tiles: Array.from(nav?.querySelectorAll('a') ?? []).map((tile) => box(tile)!),
      tileTitleSizes: Array.from(nav?.querySelectorAll('h2') ?? []).map((h) => parseFloat(getComputedStyle(h).fontSize)),
      panel: panel && getComputedStyle(panel).display !== 'none' ? box(panel) : null,
      stage: box(stage),
      close: box(close),
      rows,
      main: main ? { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, scrollWidth: main.scrollWidth, clientWidth: main.clientWidth } : null,
      documentScrollWidth: document.documentElement.scrollWidth,
      banner: banner ? { scrollWidth: banner.scrollWidth, clientWidth: banner.clientWidth } : null
    }
  })
}

test.describe('ana sayfa pencere boyutları', () => {
  test('ana sayfa her boyutta tasarım ölçüsünde kalır, büyük pencereyi içerikle doldurur, küçük pencerede taşmaz', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)

    // One favourite, so the favourites row and the panel's star have something to show.
    await openRoute(page, '/live')
    await page.getByRole('button', { name: KNOWN.liveCategory, exact: true }).click()
    const card = page.locator('div', { has: cardButton(page, KNOWN.liveChannels[0]) }).last()
    await card.getByRole('button', { name: 'Favorilere ekle' }).click()

    // A film watched half way, so the large tile is the "Kaldığın yerden" one.
    await openRoute(page, '/vod')
    await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill('Kayıp Şehir')
    await cardButton(page, KNOWN.film).click()
    await page.getByRole('button', { name: 'İzle', exact: true }).click()
    await expect(page).toHaveURL(/#\/player/)
    await waitForMpvProgress(page, { pathIncludes: '/100001.mp4', advanceBy: 1, timeout: 45_000 })
    await page.evaluate((seconds) => window.electron!.mpvSeekTo(seconds), 300)
    await expect.poll(async () => (await mpvState(page)).timePos, { timeout: 20_000 }).toBeGreaterThanOrEqual(300)
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('iptv-player-store')
            const stored = raw ? (JSON.parse(raw) as { state?: { watchProgress?: Array<{ position: number }> } }) : null
            return stored?.state?.watchProgress?.[0]?.position ?? 0
          }),
        { timeout: 25_000, intervals: [1000] }
      )
      .toBeGreaterThanOrEqual(300)
    await leavePlayer(page)
    await closeMiniPlayer(page)

    await openRoute(page, '/')
    await expectHomeWithContent(page)
    await expect(continueTile(page)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Son eklenen filmler', exact: true })).toBeVisible()

    for (const size of SIZES) {
      const label = `${size.width}x${size.height}`
      await resizeWindow(app, size.width, size.height)
      const layout = await homeLayout(page)
      const file = await app.shot(`home-${label}`)
      observe(
        `${label}: block ${Math.round(layout.block!.width)} × ${Math.round(layout.block!.height)}, ` +
          `large tile ${Math.round(layout.feature!.width)} × ${Math.round(layout.feature!.height)}, ` +
          `panel ${layout.panel ? Math.round(layout.panel.width) : 'none'}, rows: ${layout.rows.map((row) => row.title).join(', ') || 'none'}; ${file}`
      )

      // Nothing grows past 1.25 × the design.
      expect(layout.feature!.width, `${label} large tile width`).toBeLessThanOrEqual(DESIGN.feature.width * GROWTH + 1)
      expect(layout.feature!.height, `${label} large tile height`).toBeLessThanOrEqual(DESIGN.feature.height * GROWTH + 1)
      expect(layout.tiles).toHaveLength(4)
      for (const tile of layout.tiles) {
        expect(tile.width, `${label} tile width`).toBeLessThanOrEqual(DESIGN.tile.width * GROWTH + 1)
        expect(tile.height, `${label} tile height`).toBeLessThanOrEqual(DESIGN.tile.height * GROWTH + 1)
      }
      for (const fontSize of layout.tileTitleSizes) expect(fontSize).toBeLessThanOrEqual(DESIGN.tileTitle * GROWTH)

      // Nothing overflows and home does not scroll.
      expect(layout.documentScrollWidth, `${label} page width`).toBeLessThanOrEqual(size.width)
      expect(layout.main!.scrollWidth).toBeLessThanOrEqual(layout.main!.clientWidth)
      expect(layout.main!.scrollHeight, `${label} home scrolls`).toBeLessThanOrEqual(layout.main!.clientHeight)
      expect(layout.banner!.scrollWidth).toBeLessThanOrEqual(layout.banner!.clientWidth)
      expect(layout.close!.right).toBeLessThanOrEqual(size.width)
      expect(layout.close!.right, `${label} window buttons in the corner`).toBeGreaterThanOrEqual(size.width - 24 - 1)

      // The film row is there at every size; rows are whole and follow the block.
      expect(layout.rows.length, `${label} rows`).toBeGreaterThanOrEqual(1)
      let previousBottom = layout.block!.bottom
      for (const row of layout.rows) {
        expect(row.box.top - previousBottom, `${label} gap above ${row.title}`).toBeLessThanOrEqual(MAX_GAP + 1)
        expect(row.box.bottom, `${label} ${row.title} is whole`).toBeLessThanOrEqual(size.height)
        previousBottom = row.box.bottom
      }
      // No empty band under the last row.
      expect(layout.stage!.bottom - previousBottom, `${label} space under the rows`).toBeLessThanOrEqual(MAX_GAP + 1)
      // No hole beside the block: it reaches the column's right edge (or is centred in it).
      const blockLeft = layout.block!.left
      const blockRight = Math.max(...[layout.feature!, ...layout.tiles, ...(layout.panel ? [layout.panel] : [])].map((part) => part.right))
      expect(Math.abs(layout.stage!.right - blockRight - (layout.feature!.left - blockLeft)), `${label} block fills its width`).toBeLessThanOrEqual(MAX_GAP + 1)
    }

    // Still off every display.
    expect((await app.windowPlacement()).onAnyDisplay).toBe(false)
  })
})
