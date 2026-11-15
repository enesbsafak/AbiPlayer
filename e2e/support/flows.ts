// UI flows shared by the scenarios. Selectors use visible Turkish text and
// roles the app already has; no test ids were added to the app.

import { expect, type Page } from '@playwright/test'
import type { MockProvider } from '../mock-provider/server.ts'
import type { MpvStateSnapshot } from '../../src/shared/types/electron-ipc.ts'

export async function openRoute(page: Page, route: '/' | '/live' | '/vod' | '/series' | '/search' | '/settings' | '/favorites' | '/epg'): Promise<void> {
  const names: Record<string, string> = {
    '/': 'Ana Sayfa',
    '/live': 'Canlı TV',
    '/vod': 'Filmler',
    '/series': 'Diziler',
    '/epg': 'Yayın Akışı',
    '/favorites': 'Favoriler',
    '/search': 'Ara'
  }
  if (route === '/settings') {
    await page.evaluate(() => {
      window.location.hash = '#/settings'
    })
  } else {
    await page.locator('aside').getByRole('link', { name: names[route], exact: true }).click()
  }
  await expect(page).toHaveURL(new RegExp(`#${route === '/' ? '/$' : route}`))
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
  await page.getByRole('button', { name: 'Bağlan', exact: true }).click()
}

export async function addM3uSource(page: Page, url: string, name?: string): Promise<void> {
  await openRoute(page, '/settings')
  if (name) await page.locator('#m3u-name').fill(name)
  await page.locator('#m3u-url').fill(url)
  await page.getByRole('button', { name: 'Listeyi İçe Aktar' }).click()
}

/** The dashboard is showing catalog rows (not the welcome, loading or error panel). */
export async function expectHomeWithContent(page: Page, timeout = 60_000): Promise<void> {
  // A cold start sits on index.html with no hash until something navigates.
  await expect(page).toHaveURL(/(#\/|index\.html(\?[^#]*)?)$/, { timeout })
  await expect(page.getByRole('heading', { name: 'Canlı TV' })).toBeVisible({ timeout })
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

export async function leavePlayer(page: Page): Promise<void> {
  await page.mouse.move(400, 300)
  await page.getByRole('button', { name: 'Geri dön', exact: true }).click()
  await expect(page).not.toHaveURL(/#\/player/)
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
