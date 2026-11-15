import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import {
  addM3uSource,
  anyCard,
  cardButton,
  expectHomeWithContent,
  mpvState,
  openRoute,
  playLiveChannel,
  waitForMpvProgress
} from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'

/** Everything the renderer keeps in localStorage, key by key. */
async function localStorageDump(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const dump: Record<string, string> = {}
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)!
      dump[key] = localStorage.getItem(key) ?? ''
    }
    return dump
  })
}

interface StoredState {
  sources?: Array<Record<string, unknown>>
  watchProgress?: Array<{ key: string; position: number; channel: { streamUrl: string } }>
}

async function storedState(page: Page): Promise<StoredState> {
  return page.evaluate(() => {
    ;(window as unknown as { __abiPlayerFlushStore?: () => void }).__abiPlayerFlushStore?.()
    const raw = localStorage.getItem('iptv-player-store')
    return (raw ? (JSON.parse(raw) as { state?: StoredState }).state : null) ?? {}
  })
}

/** The playlist URL carries the account name and password; none of it may reach localStorage. */
async function expectNoPlaylistCredentials(page: Page, mock: { username: string; password: string }): Promise<void> {
  const dump = await localStorageDump(page)
  for (const [key, value] of Object.entries(dump)) {
    expect(value, `localStorage "${key}" holds the account password`).not.toContain(mock.password)
    expect(value, `localStorage "${key}" holds the playlist URL`).not.toContain('get.php')
  }
  const state = await storedState(page)
  const m3uSource = state.sources?.find((source) => source.type === 'm3u_url')
  expect(m3uSource, 'the M3U source is persisted').toBeTruthy()
  expect(m3uSource).not.toHaveProperty('url')
}

const FILM_PATH = '/100001.mp4'
const SEEK_TO = 120
const RESUME_TOLERANCE = 10

async function m3uFilmProgress(page: Page): Promise<number | null> {
  const entry = (await storedState(page)).watchProgress?.find((item) => item.key.startsWith('m3u:'))
  return entry ? Math.round(entry.position) : null
}

test.describe('M3U kaynağı', () => {
  test('sahte M3U adresi kaynak olarak eklenir, kanal MPEG-TS ile oynar, yeniden açılışta geri gelir', async ({ launch, mock, closeApp }) => {
    const first = await launch({ label: 'first' })
    const { page } = first
    await addM3uSource(page, mock.m3uUrl('ts'), 'Sahte M3U')
    await expectHomeWithContent(page)
    await expect(anyCard(page)).toBeVisible()
    await first.shot('home-m3u')
    // F3-02: the playlist URL lives in the secure credential store.
    await expectNoPlaylistCredentials(page, mock)

    // M3U from `output=ts` hands mpv the raw MPEG-TS URL, not HLS.
    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
    const playing = await waitForMpvProgress(page, { pathIncludes: '/1.ts', advanceBy: 2, timeout: 45_000 })
    expect(playing.last.error).toBeNull()
    expect(mock.stats().counts['live-ts']).toBeGreaterThanOrEqual(1)
    await first.shot('m3u-live-ts')
    await closeApp(first)

    const m3uBefore = mock.stats().counts.m3u ?? 0
    const second = await launch({ label: 'second' })
    await expectHomeWithContent(second.page)
    await expect(anyCard(second.page)).toBeVisible()
    // The URL came back from the secure store: the playlist was downloaded again.
    expect(mock.stats().counts.m3u ?? 0).toBeGreaterThan(m3uBefore)
    await expectNoPlaylistCredentials(second.page, mock)
    observe(`M3U downloads on restart: ${(mock.stats().counts.m3u ?? 0) - m3uBefore} (the playlist is fetched again on every start)`)
  })

  test('F3-02: M3U filminin izleme kaydı adres saklamadan yeniden açılışta kaldığı yerden sürer', async ({ launch, mock, closeApp }) => {
    const first = await launch({ label: 'first' })
    const { page } = first
    await addM3uSource(page, mock.m3uUrl('ts'), 'Sahte M3U')
    await expectHomeWithContent(page)
    await openRoute(page, '/vod')
    await page.getByPlaceholder('Kanal ara...').fill('Kayıp Şehir')
    await cardButton(page, KNOWN.film).click()
    await page.getByRole('button', { name: 'Filmi Oynat' }).click()
    await expect(page).toHaveURL(/#\/player/)
    await waitForMpvProgress(page, { pathIncludes: FILM_PATH, advanceBy: 1, timeout: 45_000 })
    await page.evaluate((seconds) => window.electron!.mpvSeekTo(seconds), SEEK_TO)
    await expect.poll(async () => (await mpvState(page)).timePos, { timeout: 20_000 }).toBeGreaterThanOrEqual(SEEK_TO)
    await expect.poll(() => m3uFilmProgress(page), { timeout: 25_000, intervals: [1000] }).toBeGreaterThanOrEqual(SEEK_TO)
    const saved = (await m3uFilmProgress(page))!

    const entry = (await storedState(page)).watchProgress!.find((item) => item.key.startsWith('m3u:'))!
    expect(entry.channel.streamUrl, 'the history entry keeps no URL').toBe('')
    await closeApp(first)

    const second = await launch({ label: 'second' })
    await expect(second.page.getByRole('heading', { name: 'Devam Et' })).toBeVisible({ timeout: 30_000 })
    await second.page.getByRole('button', { name: `${KNOWN.film} — kaldığın yerden devam et`, exact: true }).click()
    await expect(second.page).toHaveURL(/#\/player/, { timeout: 30_000 })
    await waitForMpvProgress(second.page, { pathIncludes: FILM_PATH, advanceBy: 1, timeout: 45_000 })
    await expect
      .poll(async () => (await mpvState(second.page)).timePos, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(saved - RESUME_TOLERANCE)
    observe(`M3U film: saved ${saved}s before the restart, resumed at ${Math.round((await mpvState(second.page)).timePos)}s`)
    await expectNoPlaylistCredentials(second.page, mock)
  })
})
