import { connect } from 'node:net'
import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { helpersOf } from '../support/processes.ts'
import {
  addXtreamSource,
  expectHomeWithContent,
  leavePlayer,
  playLiveChannel,
  revealPlayerControls,
  waitForMpvProgress
} from '../support/flows.ts'
import type { AbiApp } from '../support/app.ts'

// The player's controls hide on their own (with the mouse cursor), take no
// clicks while hidden, ignore a mouse nudged by a pixel or two, stay up for
// keyboard focus, and lift mpv's subtitles above themselves while shown.

/** One of mpv's numeric properties, asked over its IPC pipe as a second client. */
async function mpvNumber(app: AbiApp, property: string): Promise<number> {
  const [proc] = (await helpersOf(app.pid)).filter((item) => item.name === 'mpv.exe')
  const pipe = /--input-ipc-server=(\S+)/.exec(proc?.commandLine ?? '')?.[1]
  if (!pipe) throw new Error('no mpv pipe found')
  return new Promise<number>((resolve, reject) => {
    const socket = connect(pipe)
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('mpv did not answer'))
    }, 10_000)
    socket.on('error', reject)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ command: ['get_property', property], request_id: 9100 })}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const message = JSON.parse(line) as { request_id?: number; data?: unknown }
        if (message.request_id === 9100 && typeof message.data === 'number') {
          clearTimeout(timer)
          socket.destroy()
          resolve(message.data)
        }
      }
    })
  })
}

test.describe('oynatıcı paneli', () => {
  test('fare oynamazsa panel ve imleç gizlenir, gizli panel tıklanmaz, altyazı panelin üstüne çıkar', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)
    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
    await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 1, timeout: 45_000 })

    const controls = page.locator('[data-controls-visible]')
    const dock = page.locator('section[data-player-controls]')
    const player = page.locator('[data-player-container]')

    // The pointer rests over the picture (the card it clicked may lie where the
    // dock is, which would rightly hold the panel up); nothing else moves it,
    // and the panel hides by itself.
    await page.mouse.move(400, 300)
    await expect(controls).toHaveAttribute('data-controls-visible', 'false', { timeout: 10_000 })
    await expect(player).toHaveCSS('cursor', 'none')
    await expect(dock).toHaveCSS('pointer-events', 'none')
    await expect.poll(() => mpvNumber(app, 'sub-pos'), { timeout: 5000 }).toBe(100)

    // A real move brings panel and cursor back; subtitles go above the dock.
    await revealPlayerControls(page)
    await expect(controls).toHaveAttribute('data-controls-visible', 'true')
    await expect(player).not.toHaveCSS('cursor', 'none')
    await expect(dock).toHaveCSS('pointer-events', 'auto')
    await expect.poll(() => mpvNumber(app, 'sub-pos'), { timeout: 5000 }).toBeLessThan(100)

    // Hidden again, a nudge of a couple of pixels leaves it hidden.
    await expect(controls).toHaveAttribute('data-controls-visible', 'false', { timeout: 10_000 })
    await page.mouse.move(432, 321)
    await page.mouse.move(430, 322)
    await page.waitForTimeout(500)
    await expect(controls).toHaveAttribute('data-controls-visible', 'false')

    // Keyboard focus moving into the hidden panel shows it, and keeps it up.
    await page.keyboard.press('Shift')
    await page.getByRole('button', { name: 'Geri dön', exact: true }).focus()
    await expect(controls).toHaveAttribute('data-controls-visible', 'true')
    await page.waitForTimeout(4000)
    await expect(controls).toHaveAttribute('data-controls-visible', 'true')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect(controls).toHaveAttribute('data-controls-visible', 'false', { timeout: 10_000 })

    await leavePlayer(page)
  })
})
