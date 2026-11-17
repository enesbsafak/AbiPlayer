// UI flows shared by the scenarios. Selectors use visible Turkish text and
// roles the app already has; no test ids were added to the app.

import { expect, type Page } from '@playwright/test'
import type { MockProvider } from '../mock-provider/server.ts'
import type { MpvStateSnapshot } from '../../src/shared/types/electron-ipc.ts'

type Route = '/' | '/live' | '/vod' | '/series' | '/search' | '/settings' | '/favorites' | '/epg'

/** The four sections: home tiles and the inner bar's switcher, by these names. */
const SECTION_NAMES: Partial<Record<Route, string>> = {
  '/live': 'Canlı TV',
  '/vod': 'Filmler',
  '/series': 'Diziler',
  '/epg': 'Yayın Akışı'
}

// A cold start sits on index.html with no hash until something navigates.
const HOME_URL = /(#\/|index\.html(\?[^#]*)?)$/

function isHome(page: Page): boolean {
  return HOME_URL.test(page.url())
}

/**
 * Goes to a screen the way a viewer does. There is no sidebar: home is a
 * launcher (section tiles; Favoriler and Ayarlar in its bar; a search field),
 * and every other screen has a bar with "Ana Sayfa", a section switcher and a
 * search button.
 */
export async function openRoute(page: Page, route: Route): Promise<void> {
  const bar = page.getByRole('banner')
  const section = SECTION_NAMES[route]
  if (route === '/') {
    if (!isHome(page)) await bar.getByRole('link', { name: 'Ana Sayfa', exact: true }).click()
  } else if (section) {
    if (isHome(page)) {
      await page
        .getByRole('navigation', { name: 'Ana gezinme' })
        // The tile's name is its title and its line ("Canlı TV 128 kanal");
        // no \b: "Akışı" ends in a letter a JS word boundary does not know.
        .getByRole('link', { name: new RegExp(`^${section}( |$)`) })
        .click()
    } else {
      await bar.getByRole('navigation', { name: 'Bölümler' }).getByRole('link', { name: section, exact: true }).click()
    }
  } else if (route === '/search') {
    if (isHome(page)) await bar.getByRole('searchbox').press('Enter')
    else await bar.getByRole('link', { name: 'Arama ekranını aç', exact: true }).click()
  } else {
    // Favoriler and Ayarlar are in the home bar.
    if (!isHome(page)) {
      await bar.getByRole('link', { name: 'Ana Sayfa', exact: true }).click()
      await expect(page).toHaveURL(HOME_URL)
    }
    await bar.getByRole('link', { name: route === '/favorites' ? 'Favoriler' : 'Ayarlar', exact: true }).click()
  }
  await expect(page).toHaveURL(route === '/' ? HOME_URL : new RegExp(`#${route}`))
}

/** From a fresh profile: welcome screen, "Kaynak Ekle", the Xtream form. */
export async function addXtreamSource(page: Page, mock: MockProvider, options: { fromWelcome?: boolean; name?: string; password?: string } = {}): Promise<void> {
  if (options.fromWelcome ?? true) {
    await page.getByRole('main').getByRole('button', { name: 'Kaynak Ekle' }).click()
  } else {
    await openRoute(page, '/settings')
  }
  await expect(page.locator('#xtream-url')).toBeVisible()
  if (options.name) await page.locator('#xtream-name').fill(options.name)
  await page.locator('#xtream-url').fill(mock.url)
  await page.locator('#xtream-user').fill(mock.username)
  await page.locator('#xtream-pass').fill(options.password ?? mock.password)
  await page.getByRole('button', { name: 'Bağlan ve yüklemeye başla', exact: true }).click()
}

/** Settings → Kaynaklar: the "M3U listem var" choice, then its address. */
export async function addM3uSource(page: Page, url: string, name?: string): Promise<void> {
  await openRoute(page, '/settings')
  await page.getByRole('button', { name: /^M3U listem var/ }).click()
  if (name) await page.locator('#m3u-name').fill(name)
  await page.locator('#m3u-url').fill(url)
  await page.getByRole('button', { name: 'Listeyi yükle', exact: true }).click()
}

/**
 * Home is showing the source's content, not the welcome, loading or error
 * state: the Canlı TV tile names what the live list holds.
 */
export async function expectHomeWithContent(page: Page, timeout = 60_000): Promise<void> {
  await expect(page).toHaveURL(HOME_URL, { timeout })
  await expect(liveTile(page)).toHaveAccessibleName(/^Canlı TV (\d[\d.]* kanal|Şimdi: )/, { timeout })
}

/** Home's Canlı TV tile. */
export function liveTile(page: Page) {
  return page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: /^Canlı TV\b/ })
}

/** Home's large tile when it offers to pick up where the viewer left off. */
export function continueTile(page: Page) {
  return page.getByRole('region', { name: 'Kaldığın yerden', exact: true })
}

export function cardButton(page: Page, name: string) {
  return page.getByRole('button', { name: `${name} oynat`, exact: true })
}

/**
 * Plays a channel from the Live TV page's first category. The dashboard row is
 * not used for this: its order depends on which preview request finished first
 * and changes from run to run.
 */
export async function playLiveChannel(page: Page, category: string, name: string): Promise<void> {
  await openRoute(page, '/live')
  await page.getByRole('button', { name: category, exact: true }).click()
  await cardButton(page, name).click()
  await expect(page).toHaveURL(/#\/player/)
}

/** Any playable card on screen. */
export function anyCard(page: Page) {
  return page.getByRole('button', { name: / oynat$/ }).first()
}

export async function mpvState(page: Page): Promise<MpvStateSnapshot> {
  return page.evaluate(() => window.electron!.mpvGetState())
}

/**
 * Waits until mpv runs the expected stream and its position has advanced by
 * at least `advanceBy` seconds, sampling through the app's own IPC bridge.
 */
export async function waitForMpvProgress(
  page: Page,
  options: { pathIncludes?: string; advanceBy?: number; timeout?: number } = {}
): Promise<{ first: MpvStateSnapshot; last: MpvStateSnapshot }> {
  const deadline = Date.now() + (options.timeout ?? 30_000)
  const advanceBy = options.advanceBy ?? 1
  let first: MpvStateSnapshot | null = null
  let last: MpvStateSnapshot | null = null
  while (Date.now() < deadline) {
    const state = await mpvState(page)
    last = state
    const onPath = !options.pathIncludes || (state.path ?? '').includes(options.pathIncludes)
    if (state.running && onPath && state.timePos > 0) {
      if (!first) first = state
      else if (state.timePos - first.timePos >= advanceBy) return { first, last: state }
    }
    await page.waitForTimeout(200)
  }
  throw new Error(`mpv did not advance ${advanceBy}s on ${options.pathIncludes ?? 'any path'}; last state: ${JSON.stringify(last)}`)
}

/**
 * Brings the player's controls back. They hide 3 s after the last real
 * pointer move (or after the player opened) and take no clicks while hidden,
 * and a move of a few pixels does not count: two moves well apart over the
 * picture always do, wherever the pointer was.
 */
export async function revealPlayerControls(page: Page): Promise<void> {
  await page.mouse.move(400, 300)
  await page.mouse.move(430, 320)
}

export async function leavePlayer(page: Page): Promise<void> {
  await revealPlayerControls(page)
  await page.getByRole('button', { name: 'Geri dön', exact: true }).click()
  await expect(page).not.toHaveURL(/#\/player/)
}

/**
 * The card shown after leaving /player. Playback is suspended there (mpv is
 * stopped), so the card says "Duraklatıldı" and offers "Devam et".
 */
export function miniPlayer(page: Page) {
  return page.getByRole('region', { name: 'Mini oynatıcı' })
}

/** The mini card's "Devam et" button: its accessible name differs for live and VOD. */
export function miniPlayerResume(page: Page, kind: 'live' | 'vod') {
  return miniPlayer(page).getByRole('button', { name: kind === 'live' ? 'Yayına geri dön' : 'Kaldığın yerden devam et', exact: true })
}

/** Closes the suspended item from the mini card. */
export async function closeMiniPlayer(page: Page): Promise<void> {
  await miniPlayer(page).getByRole('button', { name: 'Oynatmayı kapat', exact: true }).click()
  await expect(miniPlayer(page)).toHaveCount(0)
}

/** The mini card is honest: it says paused, offers "Devam et", and nothing claims to play. */
export async function expectSuspendedMiniPlayer(page: Page, kind: 'live' | 'vod'): Promise<void> {
  const card = miniPlayer(page)
  await expect(card).toBeVisible()
  await expect(card).toContainText('Duraklatıldı')
  await expect(miniPlayerResume(page, kind)).toHaveText('Devam et')
  // No pause control and no "now playing" wording: there is nothing running to pause.
  await expect(card.getByRole('button', { name: /duraklat/i })).toHaveCount(0)
  await expect(card).not.toContainText(/oynatılıyor|canlı yayında/i)
  // mpv really is stopped, not just hidden: no file loaded, no position moving.
  await expect.poll(async () => (await mpvState(page)).path, { timeout: 10_000 }).toBeNull()
  const before = await mpvState(page)
  await page.waitForTimeout(1000)
  const after = await mpvState(page)
  expect(after.path).toBeNull()
  expect(after.phase ?? 'idle').toBe('idle')
  expect(after.timePos).toBe(before.timePos)
}

/**
 * Listens for keydown in the page and reports whether the app claimed the key
 * (called preventDefault). The listener sits on window, so it runs after the
 * app's document-level shortcut handler has seen the event.
 */
export async function installKeyProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { __abiKeyProbe?: Array<{ key: string; prevented: boolean }> }
    if (scope.__abiKeyProbe) return
    const log: Array<{ key: string; prevented: boolean }> = []
    scope.__abiKeyProbe = log
    window.addEventListener('keydown', (event) => log.push({ key: event.key, prevented: event.defaultPrevented }))
  })
}

export async function pressAndProbe(page: Page, key: string): Promise<boolean> {
  await installKeyProbe(page)
  await page.evaluate(() => {
    ;(window as unknown as { __abiKeyProbe: unknown[] }).__abiKeyProbe.length = 0
  })
  await page.keyboard.press(key)
  const log = await page.evaluate(() => (window as unknown as { __abiKeyProbe: Array<{ key: string; prevented: boolean }> }).__abiKeyProbe.slice())
  const entry = log.find((item) => item.key === (key === 'Space' ? ' ' : key))
  if (!entry) throw new Error(`keydown for ${key} never reached the page`)
  return entry.prevented
}

/**
 * Opens a settings tab and picks an entry from one of its dropdowns, through
 * the same menu the viewer uses.
 */
export async function pickSetting(page: Page, tab: 'playback' | 'subtitles', dropdownId: string, item: RegExp): Promise<void> {
  await page.evaluate((tab) => {
    window.location.hash = `#/settings?tab=${tab}`
  }, tab)
  const trigger = page.locator(`#${dropdownId}`)
  await trigger.click()
  await page.getByRole('menuitemradio', { name: item }).click()
  await expect(trigger).toContainText(item)
}

/**
 * Samples mpv state in the page at a fixed interval and returns the moment
 * (epoch ms) the requested stream first shows progress. Used for timing; see
 * createMpvProgressProbe in src/shared/perf.ts for why a bare timePos is not
 * enough on a channel switch.
 */
export async function timeToMpvProgress(page: Page, pathIncludes: string, timeoutMs = 30_000): Promise<number | null> {
  return page.evaluate(
    async ({ pathIncludes, timeoutMs }) => {
      const started = Date.now()
      let baseline: number | null = null
      while (Date.now() - started < timeoutMs) {
        const state = await window.electron!.mpvGetState()
        if (state.path && state.path.includes(pathIncludes)) {
          if (baseline === null) baseline = state.timePos
          else if (state.timePos > 0 && state.timePos !== baseline) return Date.now()
        }
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      return null
    },
    { pathIncludes, timeoutMs }
  )
}
