import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { addM3uSource, anyCard, expectHomeWithContent, playLiveChannel, waitForMpvProgress } from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'

test.describe('M3U kaynağı', () => {
  test('sahte M3U adresi kaynak olarak eklenir, kanal MPEG-TS ile oynar, yeniden açılışta geri gelir', async ({ launch, mock, closeApp }) => {
    const first = await launch({ label: 'first' })
    const { page } = first
    await addM3uSource(page, mock.m3uUrl('ts'), 'Sahte M3U')
    await expectHomeWithContent(page)
    await expect(anyCard(page)).toBeVisible()
    await first.shot('home-m3u')

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
    observe(`M3U downloads on restart: ${(mock.stats().counts.m3u ?? 0) - m3uBefore} (the playlist is fetched again on every start)`)
  })
})
