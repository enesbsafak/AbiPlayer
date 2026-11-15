import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { helpersOf, mainWindowHandle } from '../support/processes.ts'
import { addXtreamSource, expectHomeWithContent, leavePlayer, playLiveChannel, waitForMpvProgress } from '../support/flows.ts'

test.describe('canlı yayın mpv ile', () => {
  test('kanal açılır, mpv konumu ilerler, kanal değiştirilir, çıkılıp geri dönülür', async ({ launch, mock, closeApp }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)

    // First channel: cold mpv start.
    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
    const first = await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 2, timeout: 45_000 })
    expect(first.last.running).toBe(true)
    expect(first.last.error).toBeNull()
    // Test mode is silent (muted, volume 0, silent clips) and mpv draws only inside
    // the off-screen app window, never in a desktop window of its own.
    expect(first.last.muted || first.last.volume === 0, 'mpv is muted').toBe(true)
    const mpvProcesses = (await helpersOf(app.pid)).filter((proc) => proc.name === 'mpv.exe')
    expect(mpvProcesses).toHaveLength(1)
    expect(await mainWindowHandle(mpvProcesses[0].pid), 'mpv has no top-level window').toBe(0)
    await app.shot('first-channel')

    // Switch with the "next channel" control.
    await page.mouse.move(500, 400)
    await page.getByRole('button', { name: `Sonraki: ${KNOWN.liveChannels[1]}` }).click()
    const second = await waitForMpvProgress(page, { pathIncludes: '/2.m3u8', advanceBy: 2, timeout: 45_000 })
    expect(second.last.path).toContain('/2.m3u8')
    await app.shot('second-channel')

    // Leave the player, then come back through the dashboard.
    await leavePlayer(page)
    await app.shot('left-player')
    const afterLeave = await app.mpvState()
    test.info().annotations.push({
      type: 'observation',
      description: `after leaving the player: running=${afterLeave.running} paused=${afterLeave.paused} path=${afterLeave.path?.replace(/\/live\/[^/]+\/[^/]+\//, '/live/***/***/')}`
    })

    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[2])
    await waitForMpvProgress(page, { pathIncludes: '/3.m3u8', advanceBy: 2, timeout: 45_000 })
    await app.shot('third-channel')

    expect(mock.stats().counts['live-hls']).toBeGreaterThanOrEqual(3)
    const report = await closeApp(app)
    expect(report.strays, 'no mpv left behind after quitting').toEqual([])
  })
})
