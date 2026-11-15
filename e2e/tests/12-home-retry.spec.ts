import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../support/fixtures.ts'
import { addM3uSource, anyCard, expectHomeWithContent } from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'

/** Seconds the throttled playlist download takes, roughly. */
const DOWNLOAD_SECONDS = 15

test.describe('ana sayfada yeniden dene', () => {
  // K1: the loading panel's retry bumped the source revision of an M3U source
  // whose playlist was still downloading; the finished download was then
  // dropped, the attempt counted as a success, and the home page stayed empty
  // with no error and no further attempt.
  test('K1: "Çok uzun sürüyor, tekrar dene" inen M3U listesini çöpe atmaz', async ({ launch, mock, profileDir, closeApp }) => {
    const first = await launch({ label: 'first' })
    await addM3uSource(first.page, mock.m3uUrl('ts'), 'Yavaş Liste')
    await expectHomeWithContent(first.page)
    await expect(anyCard(first.page)).toBeVisible()
    await closeApp(first)

    // No cached copy: the next start has nothing to show until the download is in.
    rmSync(join(profileDir, 'IndexedDB'), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    const size = (await (await fetch(mock.m3uUrl('ts'))).arrayBuffer()).byteLength
    mock.update({ bandwidthBytesPerSec: Math.max(4_096, Math.ceil(size / DOWNLOAD_SECONDS)) })
    mock.resetStats()

    const second = await launch({ label: 'second' })
    const { page } = second
    const retry = page.getByRole('button', { name: 'Çok uzun sürüyor, tekrar dene' })
    await expect(retry).toBeVisible({ timeout: 30_000 })
    // The download is under way when the user gives up waiting.
    await expect.poll(() => mock.stats().counts.m3u ?? 0, { timeout: 15_000 }).toBe(1)
    await page.waitForTimeout(2_000)
    await retry.click()
    const clickedAt = Date.now()

    await expect(anyCard(page)).toBeVisible({ timeout: (DOWNLOAD_SECONDS + 45) * 1_000 })
    await second.shot('after-retry')
    observe(`playlist of ${size} bytes on screen ${Math.round((Date.now() - clickedAt) / 1000)} s after the retry`)
    // The download in flight was kept, not thrown away and fetched again.
    expect(mock.stats().counts.m3u ?? 0).toBe(1)
    mock.update({ bandwidthBytesPerSec: null })
  })
})
