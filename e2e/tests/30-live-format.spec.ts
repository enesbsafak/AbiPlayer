import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import {
  addXtreamSource,
  closeMiniPlayer,
  expectHomeWithContent,
  leavePlayer,
  pickSetting,
  playLiveChannel,
  waitForMpvProgress
} from '../support/flows.ts'

// Plan F2-04: "Canlı yayın biçimi" decides which format mpv asks the Xtream
// panel for. The mock panel allows both (allowed_output_formats m3u8, ts).

test.describe('canlı yayın biçimi (F2-04)', () => {
  test('mpv ile canlı kanal hem HLS hem MPEG-TS biçiminde oynar', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)

    await pickSetting(page, 'playback', 'live-stream-format', /^MPEG-TS$/)
    mock.resetStats()
    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
    const ts = await waitForMpvProgress(page, { pathIncludes: '/1.ts', advanceBy: 2, timeout: 45_000 })
    expect(ts.last.error).toBeNull()
    expect(mock.stats().counts['live-ts'] ?? 0).toBeGreaterThan(0)
    expect(mock.stats().counts['live-hls'] ?? 0).toBe(0)
    await app.shot('mpeg-ts')

    await leavePlayer(page)
    await closeMiniPlayer(page)
    await pickSetting(page, 'playback', 'live-stream-format', /^HLS$/)
    mock.resetStats()
    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
    const hls = await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 2, timeout: 45_000 })
    expect(hls.last.error).toBeNull()
    expect(mock.stats().counts['live-hls'] ?? 0).toBeGreaterThan(0)
    expect(mock.stats().counts['live-ts'] ?? 0).toBe(0)
    await app.shot('hls')
  })

  test.describe('panel MPEG-TS vermiyor', () => {
    test.use({ mockOptions: { failures: [{ route: 'live-ts', mode: 'http-404' }] } })

    test('seçilen biçimde açılmayan kanal bir kez HLS ile denenir ve kullanıcıya söylenir', async ({ launch, mock }) => {
      const app = await launch()
      const { page } = app
      await addXtreamSource(page, mock)
      await expectHomeWithContent(page)
      await pickSetting(page, 'playback', 'live-stream-format', /^MPEG-TS$/)

      await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
      await expect(page.getByRole('status')).toContainText('MPEG-TS biçiminde açılamadı; HLS ile deneniyor', { timeout: 15_000 })
      const playing = await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 2, timeout: 45_000 })
      expect(playing.last.error).toBeNull()
      // Tried in MPEG-TS, then HLS for good: no further MPEG-TS requests, no error panel.
      const tsRequests = mock.stats().counts['live-ts'] ?? 0
      expect(tsRequests).toBeGreaterThanOrEqual(1)
      await page.waitForTimeout(3000)
      expect(mock.stats().counts['live-ts'] ?? 0).toBe(tsRequests)
      expect((await app.mpvState()).path).toContain('/1.m3u8')
      await expect(page.getByRole('button', { name: 'Yeniden Bağlan', exact: true })).toHaveCount(0)
      await app.shot('fell-back-to-hls')
    })
  })
})
