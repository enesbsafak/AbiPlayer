import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { helpersOf, killQuietly, mainWindowHandle } from '../support/processes.ts'
import { observe } from '../support/known-bugs.ts'
import {
  addXtreamSource,
  cardButton,
  expectHomeWithContent,
  openRoute,
  expectSuspendedMiniPlayer,
  leavePlayer,
  miniPlayerResume,
  playLiveChannel,
  revealPlayerControls,
  waitForMpvProgress
} from '../support/flows.ts'
import { defined, itemAt } from '../../src/shared/checked.ts'

test.describe('canlı yayın mpv ile', () => {
  test('kanal açılır, mpv konumu ilerler, kanal değiştirilir, çıkılıp geri dönülür', { tag: '@packaged' }, async ({ launch, mock, closeApp }) => {
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
    expect(await mainWindowHandle(itemAt(mpvProcesses, 0).pid), 'mpv has no top-level window').toBe(0)
    await app.shot('first-channel')

    // Switch with the "next channel" control.
    await revealPlayerControls(page)
    await page.getByRole('button', { name: `Sonraki: ${KNOWN.liveChannels[1]}` }).click()
    const second = await waitForMpvProgress(page, { pathIncludes: '/2.m3u8', advanceBy: 2, timeout: 45_000 })
    expect(second.last.path).toContain('/2.m3u8')
    await app.shot('second-channel')

    // Leaving suspends playback; the mini card's "Devam et" simply restarts the channel.
    await leavePlayer(page)
    await expectSuspendedMiniPlayer(page, 'live')
    await app.shot('left-player')
    await miniPlayerResume(page, 'live').click()
    await expect(page).toHaveURL(/#\/player/)
    await waitForMpvProgress(page, { pathIncludes: '/2.m3u8', advanceBy: 2, timeout: 45_000 })

    // F1-06: mpv dies under a live channel. The player must notice and bring it back.
    const before = await app.mpvState()
    const [victim] = (await helpersOf(app.pid)).filter((proc) => proc.name === 'mpv.exe')
    expect(victim, 'mpv is running').toBeDefined()
    killQuietly(defined(victim, 'the mpv process').pid)
    await expect.poll(async () => (await app.mpvState()).sessionId, { timeout: 30_000 }).not.toBe(before.sessionId)
    const recovered = await waitForMpvProgress(page, { pathIncludes: '/2.m3u8', advanceBy: 2, timeout: 45_000 })
    expect(recovered.last.error).toBeNull()
    expect((await helpersOf(app.pid)).filter((proc) => proc.name === 'mpv.exe'), 'one mpv after the restart').toHaveLength(1)
    await app.shot('after-mpv-crash')

    await leavePlayer(page)
    await expectSuspendedMiniPlayer(page, 'live')
    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[2])
    await waitForMpvProgress(page, { pathIncludes: '/3.m3u8', advanceBy: 2, timeout: 45_000 })
    await app.shot('third-channel')

    expect(mock.stats().counts['live-hls']).toBeGreaterThanOrEqual(3)
    const report = await closeApp(app)
    expect(report.strays, 'no mpv left behind after quitting').toEqual([])
  })

  // The plan's cold-start race (section on F2-05): a stop issued while mpv is
  // still starting used to be lost, and the stream started playing behind the
  // mini card.
  test('soğuk başlangıçta oynatıcıdan çıkmak hiçbir şey yüklemez', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)
    await openRoute(page, '/live')
    await page.getByRole('button', { name: KNOWN.liveCategory, exact: true }).click()
    await cardButton(page, KNOWN.liveChannels[0]).click()

    // Leave (Escape, the player's own shortcut) the moment the open request
    // reaches mpv, from inside the page so no round trip to the test runner
    // sits between the two.
    const leftDuring = await page.evaluate(async () => {
      const started = Date.now()
      while (Date.now() - started < 15_000) {
        const state = await window.electron!.mpvGetState()
        if (state.phase === 'loading') {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          return { phase: state.phase, path: state.path }
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return null
    })
    expect(leftDuring, 'caught mpv while it was starting').not.toBeNull()
    observe(`left the player during mpv phase=${leftDuring!.phase}, path ${leftDuring!.path ? 'already set' : 'not set yet'}`)
    await expect(page).not.toHaveURL(/#\/player/)

    await page.waitForTimeout(5000)
    await expectSuspendedMiniPlayer(page, 'live')
    const state = await app.mpvState()
    expect(state.path, 'nothing is loaded after the stop').toBeNull()
    expect(state.phase ?? 'idle').toBe('idle')
    await app.shot('stopped-during-cold-start')
  })
})
