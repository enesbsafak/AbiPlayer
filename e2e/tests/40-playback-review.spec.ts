import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { observe } from '../support/known-bugs.ts'
import {
  addXtreamSource,
  expectHomeWithContent,
  pickSetting,
  playLiveChannel,
  waitForMpvProgress
} from '../support/flows.ts'

// Findings of the independent review of the playback layer (P3, P4).

test.describe('oynatma incelemesi', () => {
  // P3: mpv draws over the window from its own process. A renderer reload
  // (Ctrl+R in development, DevTools, a reload from the crash recovery) used
  // to leave it playing over the reloaded page with nothing to stop it.
  test('P3: sayfa yeniden yüklenince mpv durur', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)
    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
    await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 2, timeout: 45_000 })

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Canlı TV' }).first()).toBeVisible({ timeout: 60_000 })
    await expect.poll(async () => (await app.mpvState()).path, { timeout: 15_000 }).toBeNull()
    const stopped = await app.mpvState()
    expect(stopped.phase ?? 'idle').toBe('idle')
    // And it stays that way: nothing on the reloaded page plays it again.
    await page.waitForTimeout(3000)
    const later = await app.mpvState()
    expect(later.path).toBeNull()
    expect(later.timePos).toBe(stopped.timePos)
    await app.shot('after-reload')
  })

  test.describe('panel canlı MPEG-TS yayınını temizce kapatıyor', () => {
    test.use({ mockOptions: { failures: [{ route: 'live-ts', mode: 'end', afterMs: 6000, times: 1 }] } })

    // P4: mpv runs with --keep-open; a live stream the server ends cleanly
    // reached "ended" with no error and was never reconnected.
    test('P4: temizce biten canlı yayın yeniden bağlanır', async ({ launch, mock }) => {
      const app = await launch()
      const { page } = app
      await addXtreamSource(page, mock)
      await expectHomeWithContent(page)
      await pickSetting(page, 'playback', 'live-stream-format', /^MPEG-TS$/)

      await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
      await waitForMpvProgress(page, { pathIncludes: '/1.ts', advanceBy: 1, timeout: 45_000 })
      expect(mock.stats().counts['live-ts']).toBe(1)

      // The server finishes the response; mpv plays out what it has and ends.
      await expect.poll(async () => (await app.mpvState()).phase, { timeout: 45_000, intervals: [100] }).toBe('ended')
      observe('mpv reported phase "ended" after the clean end of the live TS response')

      await expect.poll(() => mock.stats().counts['live-ts'] ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
      const again = await waitForMpvProgress(page, { pathIncludes: '/1.ts', advanceBy: 2, timeout: 45_000 })
      expect(again.last.error).toBeNull()
      expect(again.last.phase).toBe('playing')
      await expect(page.getByText(/yeniden bağlanılıyor/)).toHaveCount(0, { timeout: 15_000 })
      await app.shot('reconnected')
    })
  })
})
