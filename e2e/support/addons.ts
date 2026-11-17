// Flows and checks for add-on sources (mock-provider/addons.ts): the
// experimental switch, the add step's add-on form, the stream picker, and the
// checks that an add-on's address and its stream URLs never leave memory.

import { expect, type Page } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ADDON_KNOWN, type MockAddons } from '../mock-provider/addons.ts'
import type { AbiApp } from './app.ts'
import { openRoute } from './flows.ts'

/** Settings → Kaynaklar → Deneysel: the switch's label. */
export const ADDON_SWITCH_LABEL = 'Eklenti kaynakları (deneysel)'

/** The add step's third choice, shown only while the experimental switch is on. */
export function addonChoice(page: Page) {
  return page.getByRole('button', { name: /^Eklenti adresim var/ })
}

export function addonSwitch(page: Page) {
  return page.getByRole('checkbox', { name: ADDON_SWITCH_LABEL, exact: true })
}

/** Settings → Kaynaklar, the experimental switch on. */
export async function enableAddonSources(page: Page): Promise<void> {
  await openRoute(page, '/settings')
  await addonSwitch(page).check()
  await expect(addonSwitch(page)).toBeChecked()
  await expect(addonChoice(page)).toBeVisible()
}

export function addonField(page: Page) {
  return page.locator('#addon-url')
}

/** The error under the address field. */
export function addonFieldError(page: Page) {
  return page.locator('#addon-url-error')
}

/** What a checked address turned out to be, before it is added. */
export function addonReview(page: Page) {
  return page.getByRole('region', { name: 'Bulunan eklenti', exact: true })
}

/** The add-on form of the add step (Settings → Kaynaklar must be open). */
export async function openAddonForm(page: Page): Promise<void> {
  if (!(await addonField(page).isVisible())) await addonChoice(page).click()
  await expect(addonField(page)).toBeVisible()
}

/** Types an address and asks for it to be checked. */
export async function checkAddonAddress(page: Page, address: string): Promise<void> {
  await openAddonForm(page)
  await addonField(page).fill(address)
  await page.getByRole('button', { name: 'Eklentiyi kontrol et', exact: true }).click()
}

/** Checks an address, waits for the review naming `name`, and adds it. */
export async function addAddon(page: Page, address: string, name: string): Promise<void> {
  await checkAddonAddress(page, address)
  await expect(addonReview(page)).toContainText(name)
  await page.getByRole('button', { name: 'Eklentiyi ekle', exact: true }).click()
}

/** The line the form shows after adding an add-on that did not become the source in use. */
export function addonAddedStatus(page: Page, name: string) {
  return page.getByRole('status').filter({ hasText: `"${name}" eklendi.` })
}

/**
 * From a fresh profile: the switch on, the catalogue add-on added (the first
 * source becomes the one in use and the app goes home), then the stream
 * add-on (it cannot be in use, so the form stays and says it was added).
 */
export async function installAddons(page: Page, addons: MockAddons): Promise<void> {
  await enableAddonSources(page)
  await addAddon(page, addons.catalogUrl, ADDON_KNOWN.catalogName)
  await expectAddonHome(page)
  await openRoute(page, '/settings')
  await addAddon(page, addons.streamUrl, ADDON_KNOWN.streamName)
  await expect(addonAddedStatus(page, ADDON_KNOWN.streamName)).toBeVisible()
}

/** Home with the catalogue add-on in use: its tiles say what it has (and has not). */
export async function expectAddonHome(page: Page, timeout = 30_000): Promise<void> {
  await expect(page).toHaveURL(/(#\/|index\.html(\?[^#]*)?)$/, { timeout })
  const tiles = page.getByRole('navigation', { name: 'Ana gezinme' })
  await expect(tiles.getByRole('link', { name: /^Canlı TV Bu kaynakta canlı TV yok/ })).toBeVisible({ timeout })
  await expect(tiles.getByRole('link', { name: /^Filmler 2 katalog/ })).toBeVisible({ timeout })
  await expect(tiles.getByRole('link', { name: /^Diziler 1 katalog/ })).toBeVisible({ timeout })
}

/** The stream picker sheet. */
export function streamPicker(page: Page) {
  return page.getByRole('dialog', { name: 'Yayın seç', exact: true })
}

/** The candidates listed in the picker, in order. */
export function streamCandidates(page: Page) {
  return streamPicker(page).getByRole('group', { name: 'Yayın adayları', exact: true }).getByRole('button')
}

/** Closes the picker with its own close button. */
export async function closeStreamPicker(page: Page): Promise<void> {
  await streamPicker(page).getByRole('button', { name: 'Kapat', exact: true }).click()
  await expect(streamPicker(page)).toHaveCount(0)
}

/** The add-on category list of a catalog page. */
export function categoryList(page: Page) {
  return page.getByRole('group', { name: 'Kategoriler', exact: true })
}

/** The line under an add-on category's grid once its last page is in. */
export function catalogEndLine(page: Page) {
  return page.getByText('Katalogun sonuna geldin', { exact: true })
}

/** Saved position (s) of an add-on film or episode, by its video id; null when none is stored. */
export async function addonProgress(page: Page, videoId: string): Promise<number | null> {
  return page.evaluate((videoId) => {
    const raw = localStorage.getItem('iptv-player-store')
    const parsed = raw ? (JSON.parse(raw) as { state?: { watchProgress?: Array<{ key: string; position: number }> } }) : null
    const suffix = `:${encodeURIComponent(videoId)}`
    const entry = (parsed?.state?.watchProgress ?? []).find((item) => item.key.startsWith('addon:') && item.key.endsWith(suffix))
    return entry ? Math.round(entry.position) : null
  }, videoId)
}

/**
 * Records whether any `<dialog>` opens from now on (a sheet that shows for a
 * moment would be missed by a later look). Read with `dialogOpenedSince`.
 */
export async function watchForDialogs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { __abiDialogSeen?: boolean; __abiDialogObserver?: MutationObserver }
    scope.__abiDialogObserver?.disconnect()
    scope.__abiDialogSeen = !!document.querySelector('dialog[open]')
    const observer = new MutationObserver(() => {
      if (document.querySelector('dialog[open]')) scope.__abiDialogSeen = true
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    scope.__abiDialogObserver = observer
  })
}

export async function dialogOpenedSince(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scope = window as unknown as { __abiDialogSeen?: boolean; __abiDialogObserver?: MutationObserver }
    scope.__abiDialogObserver?.disconnect()
    return scope.__abiDialogSeen === true
  })
}

/** The window's content size now. */
export async function windowSize(app: AbiApp): Promise<{ width: number; height: number }> {
  const [width, height] = await app.page.evaluate(() => [window.innerWidth, window.innerHeight])
  return { width: width ?? 0, height: height ?? 0 }
}

/**
 * Resizes the window's content area. The window stays where test mode put
 * it, off every display.
 */
export async function resizeWindow(app: AbiApp, width: number, height: number): Promise<void> {
  await app.electron.evaluate(({ BrowserWindow }, size) => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) throw new Error('the app has no window')
    window.setContentSize(size.width, size.height)
  }, { width, height })
  await expect.poll(() => app.page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([width, height])
  await app.page.waitForTimeout(300)
}

/** Shoots the screen at 900 × 600 (the smallest window), then puts the size back. */
export async function shotAtSmallestWindow(app: AbiApp, name: string): Promise<void> {
  const before = await windowSize(app)
  await resizeWindow(app, 900, 600)
  await app.shot(name)
  await resizeWindow(app, before.width, before.height)
}

/** Names the secret a haystack holds without printing it. */
function secretNames(haystack: string, secrets: readonly string[]): string[] {
  return secrets.flatMap((secret, index) => (haystack.includes(secret) ? [`secret #${index}`] : []))
}

/**
 * The add-ons' secret segment, their stream URLs and the URLs' random parts
 * appear nowhere the app shows, stores or logs: the page's markup and text,
 * the values of its fields, localStorage and sessionStorage, the renderer's
 * console, and what reached the add-on server outside the add-ons' own paths
 * (the images). Secret #0 is the segment; the main process's output is only
 * reported (mpv is handed the stream URL, and may print it).
 */
export async function expectNoAddonSecrets(app: AbiApp, addons: MockAddons, label: string): Promise<void> {
  const secrets = addons.secrets()
  const inPage = await app.page.evaluate((secrets) => {
    const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
      .map((field) => field.value)
      .join('\n')
    const storage = JSON.stringify({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage)
    })
    const places: Record<string, string> = {
      'page markup': document.documentElement.outerHTML,
      'page text': document.body.innerText,
      'field values': fields,
      storage
    }
    const found: string[] = []
    for (const [place, haystack] of Object.entries(places)) {
      secrets.forEach((secret, index) => {
        if (haystack.includes(secret)) found.push(`${place}: secret #${index}`)
      })
    }
    return found
  }, secrets)
  expect(inPage, `${label}: the page holds an add-on secret`).toEqual([])

  const rendererLeaks = app.logs
    .filter((line) => line.startsWith('[renderer'))
    .flatMap((line, index) => secretNames(line, secrets).map((name) => `renderer line ${index}: ${name}`))
  expect(rendererLeaks, `${label}: the renderer console holds an add-on secret`).toEqual([])

  const elsewhere = addons
    .requests()
    .filter((request) => request.route === 'img')
    .flatMap((request) => secretNames(JSON.stringify(request), secrets).map((name) => `${request.route} request: ${name}`))
  expect(elsewhere, `${label}: a request outside the add-ons' paths carried a secret`).toEqual([])
}

/** Lines of the main process's output that hold an add-on secret (reported, not asserted). */
export function mainLogLinesWithSecrets(app: AbiApp, addons: MockAddons): number {
  const secrets = addons.secrets()
  return app.logs.filter((line) => line.startsWith('[main') && secrets.some((secret) => line.includes(secret))).length
}

/**
 * Files of the closed profile's web storage (Local Storage, Session Storage)
 * and the store backup that hold a secret, as UTF-8 or UTF-16 (Chromium keeps
 * storage values in either). The leveldb tables may be compressed, so a miss
 * is not proof; a hit always is.
 */
export function profileFilesHoldingSecrets(profileDir: string, addons: MockAddons): string[] {
  const needles = addons.secrets().flatMap((secret) => [Buffer.from(secret, 'utf8'), Buffer.from(secret, 'utf16le')])
  const files: string[] = []
  const walk = (path: string) => {
    if (!existsSync(path)) return
    const stat = statSync(path)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) walk(join(path, entry))
    } else if (stat.isFile() && stat.size < 64 * 1024 * 1024) {
      files.push(path)
    }
  }
  for (const root of ['Local Storage', 'Session Storage', 'store-backup.json']) walk(join(profileDir, root))
  return files.filter((file) => {
    let data: Buffer
    try {
      data = readFileSync(file)
    } catch {
      return false
    }
    return needles.some((needle) => data.includes(needle))
  }).map((file) => relative(profileDir, file))
}
