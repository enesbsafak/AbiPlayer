import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import sharp from 'sharp'
import { test, expect } from '../support/fixtures.ts'
import type { AbiApp } from '../support/app.ts'
import { DEMO, DEMO_ASSETS_DIR } from '../mock-provider/demo.ts'
import { demoLiveDir } from '../mock-provider/media.ts'
import { E2E_CACHE_DIR, REPO_ROOT } from '../support/paths.ts'
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

// The README's screenshots, from the demo catalog: invented channels, titles
// and programmes, posters made for it. The window stays off every display, as
// in the e2e suite; only its size is set.

const SIZE = { width: 1280, height: 800 }
const IMAGES_DIR = join(REPO_ROOT, 'docs', 'images')

// The live channels play a full-HD clip, so the player's quality reads 1080p.
test.use({ mockOptions: { demo: true, username: 'demo', liveDir: demoLiveDir(E2E_CACHE_DIR) } })

async function resizeWindow(app: AbiApp): Promise<void> {
  await app.electron.evaluate(({ BrowserWindow }, size) => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) throw new Error('the app has no window')
    window.setContentSize(size.width, size.height)
  }, SIZE)
  await expect.poll(() => app.page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([SIZE.width, SIZE.height])
}

/** Every picture on the page has arrived (or failed), and the layout has settled. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), undefined, { timeout: 20_000 })
  await page.waitForTimeout(600)
}

/** The page as it is drawn, saved as a compressed PNG under docs/images. */
async function save(page: Page, name: string): Promise<void> {
  const png = await page.screenshot()
  await sharp(png).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(join(IMAGES_DIR, name))
}

test('README ekran görüntüleri', async ({ launch, mock }) => {
  mkdirSync(IMAGES_DIR, { recursive: true })
  const app = await launch()
  const { page } = app
  await resizeWindow(app)
  await addXtreamSource(page, mock, { name: DEMO.sourceName })
  await expectHomeWithContent(page)

  // The guide first, so the channel rows and the home tile have programmes.
  await openRoute(page, '/epg')
  await expect(page.getByText('Yayın akışı yükleniyor…')).toHaveCount(0, { timeout: 60_000 })

  // Two favourite channels, for the stars and the Favoriler row.
  await openRoute(page, '/live')
  await page.getByRole('button', { name: 'Tüm Kanallar' }).click()
  for (const name of [DEMO.playerChannel, DEMO.focusChannel]) {
    const row = page.locator('div', { has: cardButton(page, name) }).last()
    await row.getByRole('button', { name: 'Favorilere ekle' }).click()
  }

  // The player, with its dock up. mpv draws the picture in a native layer
  // under the transparent page, which a page capture does not contain, so
  // the capture is laid over a still made for this.
  await page.getByRole('button', { name: DEMO.liveCategory, exact: true }).click()
  await cardButton(page, DEMO.playerChannel).click()
  await expect(page).toHaveURL(/#\/player/)
  await waitForMpvProgress(page, { advanceBy: 1, timeout: 45_000 })
  await page.mouse.move(SIZE.width / 2, SIZE.height / 2)
  await page.mouse.move(SIZE.width / 2 + 12, SIZE.height / 2 + 8)
  await page.waitForTimeout(600)
  const overlay = await page.screenshot({ omitBackground: true })
  await sharp(join(DEMO_ASSETS_DIR, DEMO.playerStill))
    .resize(SIZE.width, SIZE.height, { fit: 'cover' })
    .composite([{ input: overlay }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(join(IMAGES_DIR, '03-oynatici.png'))
  await leavePlayer(page)
  await closeMiniPlayer(page)

  // A film watched part of the way, so home opens on "Kaldığın yerden".
  await openRoute(page, '/vod')
  await cardButton(page, DEMO.film).click()
  await page.getByRole('button', { name: 'İzle', exact: true }).click()
  await expect(page).toHaveURL(/#\/player/)
  await waitForMpvProgress(page, { pathIncludes: `/${DEMO.filmId}.mp4`, advanceBy: 1, timeout: 45_000 })
  await page.evaluate((seconds) => window.electron!.mpvSeekTo(seconds), 260)
  await expect.poll(async () => (await mpvState(page)).timePos, { timeout: 20_000 }).toBeGreaterThanOrEqual(260)
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
    .toBeGreaterThanOrEqual(260)
  await leavePlayer(page)
  await closeMiniPlayer(page)

  // Ana sayfa
  await openRoute(page, '/')
  await expectHomeWithContent(page)
  await expect(continueTile(page)).toBeVisible()
  await page.mouse.move(SIZE.width - 2, SIZE.height - 2)
  await settle(page)
  await save(page, '01-ana-sayfa.png')

  // Canlı TV, a channel chosen with the keyboard so the panel shows its programme.
  await openRoute(page, '/live')
  await page.getByRole('button', { name: 'Tüm Kanallar' }).click()
  const channels = page.getByRole('group', { name: 'Kanallar', exact: true })
  await channels.getByRole('button', { name: / oynat$/ }).first().focus()
  const index = await channels.getByRole('button', { name: / oynat$/ }).evaluateAll(
    (buttons, label) => buttons.findIndex((button) => button.getAttribute('aria-label') === label),
    `${DEMO.focusChannel} oynat`
  )
  expect(index).toBeGreaterThan(0)
  await page.keyboard.press('ArrowDown', { delay: 20 })
  for (let step = 1; step < index; step += 1) await page.keyboard.press('ArrowDown')
  await expect(cardButton(page, DEMO.focusChannel)).toBeFocused()
  await settle(page)
  await save(page, '02-canli-tv.png')

  // Yayın Akışı
  await openRoute(page, '/epg')
  await expect(page.getByText('Yayın akışı yükleniyor…')).toHaveCount(0, { timeout: 60_000 })
  await settle(page)
  await save(page, '05-yayin-akisi.png')

  // Filmler
  await openRoute(page, '/vod')
  await page.getByRole('button', { name: 'Tüm Filmler', exact: true }).click()
  await settle(page)
  await save(page, '06-filmler.png')

  // Ayarlar → Oynatma
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=playback'
  })
  await page.waitForTimeout(400)
  await settle(page)
  await save(page, '04-ayarlar.png')

  expect((await app.windowPlacement()).onAnyDisplay).toBe(false)
})
