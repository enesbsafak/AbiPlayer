import { connect } from 'node:net'
import { inflateSync } from 'node:zlib'
import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { helpersOf } from '../support/processes.ts'
import { addXtreamSource, expectHomeWithContent, miniPlayer, mpvState, playLiveChannel, revealPlayerControls, waitForMpvProgress } from '../support/flows.ts'
import type { AbiApp } from '../support/app.ts'
import { itemAt } from '../../src/shared/checked.ts'

// Plan F2-15 (decision K1), experimental and off by default: with the setting
// on, leaving the player keeps mpv playing in a corner of the window. The
// harness window is off-screen, so nobody sees the picture here; this checks
// what can be checked: mpv keeps advancing, the margins mpv was given, the
// transparent hole in the page, expanding and closing.

const SIDES = ['left', 'right', 'top', 'bottom'] as const
type Margins = Record<(typeof SIDES)[number], number>

/** mpv's own idea of its video margins, asked over its IPC pipe as a second client. */
async function mpvMargins(app: AbiApp): Promise<Margins> {
  const [proc] = (await helpersOf(app.pid)).filter((item) => item.name === 'mpv.exe')
  const pipe = /--input-ipc-server=(\S+)/.exec(proc?.commandLine ?? '')?.[1]
  if (!pipe) throw new Error('no mpv pipe found')
  return new Promise<Margins>((resolve, reject) => {
    const socket = connect(pipe)
    const result: Partial<Margins> = {}
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('mpv did not answer'))
    }, 10_000)
    socket.on('error', reject)
    socket.on('connect', () => {
      SIDES.forEach((side, index) => {
        socket.write(`${JSON.stringify({ command: ['get_property', `video-margin-ratio-${side}`], request_id: 9000 + index })}\n`)
      })
    })
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const message = JSON.parse(line) as { request_id?: number; data?: number }
        const side = message.request_id !== undefined ? SIDES[message.request_id - 9000] : undefined
        if (side && typeof message.data === 'number') result[side] = message.data
      }
      if (SIDES.every((side) => typeof result[side] === 'number')) {
        clearTimeout(timer)
        socket.destroy()
        resolve(result as Margins)
      }
    })
  })
}

/** Alpha of one pixel of a page screenshot taken with a transparent default background. */
function alphaAt(png: Buffer, x: number, y: number): number {
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data.readUInt8(9)
      if (data.readUInt8(8) !== 8 || data.readUInt8(12) !== 0) throw new Error('unexpected PNG format')
    } else if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }
  if (colorType !== 6) throw new Error(`PNG without alpha (color type ${colorType})`)
  const bpp = 4
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const rows: Buffer[] = []
  for (let row = 0; row < height; row += 1) {
    const filter = raw.readUInt8(row * (stride + 1))
    const line = Buffer.from(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)))
    const previous = rows[row - 1]
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? line.readUInt8(i - bpp) : 0
      const b = previous ? previous.readUInt8(i) : 0
      const c = previous && i >= bpp ? previous.readUInt8(i - bpp) : 0
      let value = line.readUInt8(i)
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += Math.floor((a + b) / 2)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = value & 0xff
    }
    rows.push(line)
  }
  return itemAt(rows, y).readUInt8(x * bpp + 3)
}

async function cornerBox(page: Page) {
  const box = await page.getByRole('region', { name: 'Köşe oynatıcı' }).boundingBox()
  if (!box) throw new Error('corner player has no box')
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  return { box, viewport }
}

async function turnOnCornerSetting(page: Page) {
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=playback'
  })
  const checkbox = page.getByRole('checkbox', { name: 'Oynatıcıdan çıkınca köşede oynatmaya devam et (deneysel)' })
  await checkbox.check()
  await expect(checkbox).toBeChecked()
}

async function backFromPlayer(page: Page) {
  await revealPlayerControls(page)
  await page.getByRole('button', { name: 'Geri dön', exact: true }).click()
  await expect(page).not.toHaveURL(/#\/player/)
}

test.describe('köşede oynatma (F2-15, deneysel)', () => {
  test('ayar açıkken oynatıcıdan çıkınca mpv köşede sürer; büyüt ve kapat çalışır', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)
    await turnOnCornerSetting(page)

    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
    await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 1, timeout: 45_000 })
    const before = await mpvState(page)

    // Leave: no "paused" card, a corner player instead, and mpv keeps going on the same load.
    await backFromPlayer(page)
    await expect(page.getByRole('region', { name: 'Köşe oynatıcı' })).toBeVisible()
    await expect(miniPlayer(page)).toHaveCount(0)
    const moving = await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 2, timeout: 20_000 })
    expect(moving.last.loadId, 'not reloaded').toBe(before.loadId)
    expect(moving.last.playbackId).toBe(before.playbackId)
    expect(moving.last.paused).toBe(false)

    // mpv's picture is confined to the corner rectangle.
    const { box, viewport } = await cornerBox(page)
    await expect.poll(async () => (await mpvMargins(app)).left, { timeout: 10_000 }).toBeGreaterThan(0)
    const margins = await mpvMargins(app)
    const expected = {
      left: box.x / viewport.width,
      right: (viewport.width - box.x - box.width) / viewport.width,
      top: box.y / viewport.height,
      bottom: (viewport.height - box.y - box.height) / viewport.height
    }
    for (const side of SIDES) expect(margins[side], `margin ${side}`).toBeCloseTo(expected[side], 2)

    // The page is transparent inside the rectangle (mpv shows through) and opaque around it.
    const shot = await page.screenshot({ omitBackground: true, scale: 'css' })
    const inside = alphaAt(shot, Math.round(box.x + box.width / 2), Math.round(box.y + box.height * 0.75))
    const outside = alphaAt(shot, Math.round(box.x - 24), Math.round(box.y + box.height / 2))
    const above = alphaAt(shot, Math.round(box.x + box.width / 2), Math.round(box.y - 24))
    expect(inside, 'transparent inside the corner').toBe(0)
    expect(outside, 'opaque left of the corner').toBe(255)
    expect(above, 'opaque above the corner').toBe(255)
    await app.shot('corner')

    // Expand: back to the full player, same load, full-size picture.
    await page.getByRole('button', { name: 'Oynatıcıyı büyüt', exact: true }).click()
    await expect(page).toHaveURL(/#\/player/)
    await expect.poll(async () => (await mpvMargins(app)).left, { timeout: 10_000 }).toBe(0)
    expect(await mpvMargins(app)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
    const expanded = await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 1, timeout: 20_000 })
    expect(expanded.last.loadId, 'expanding does not reload').toBe(before.loadId)

    // Leave again and close from the corner: playback ends, mpv stops.
    await backFromPlayer(page)
    await page.getByRole('region', { name: 'Köşe oynatıcı' }).getByRole('button', { name: 'Oynatmayı kapat', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Köşe oynatıcı' })).toHaveCount(0)
    await expect(miniPlayer(page)).toHaveCount(0)
    await expect.poll(async () => (await mpvState(page)).path, { timeout: 10_000 }).toBeNull()
    expect((await mpvState(page)).phase).toBe('idle')
    await app.shot('closed')
  })
})
