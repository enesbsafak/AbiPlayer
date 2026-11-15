// Tiny PNG encoder for offline artwork: a colour derived from the id, with a
// diagonal band so posters are distinguishable in screenshots.

import { deflateSync } from 'node:zlib'
import { itemAt } from '../../src/shared/checked.ts'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = itemAt(CRC_TABLE, (crc ^ byte) & 0xff) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function hsl(hue: number, saturation: number, lightness: number): [number, number, number] {
  const a = saturation * Math.min(lightness, 1 - lightness)
  const f = (n: number) => {
    const k = (n + hue / 30) % 12
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

export function artworkPng(seed: number, width: number, height: number): Buffer {
  const hue = (seed * 47) % 360
  const [r, g, b] = hsl(hue, 0.55, 0.42)
  const [r2, g2, b2] = hsl((hue + 40) % 360, 0.6, 0.6)
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const band = Math.abs(x - y * (width / height)) < width * 0.12
      const offset = row + 1 + x * 3
      raw[offset] = band ? r2 : r
      raw[offset + 1] = band ? g2 : g
      raw[offset + 2] = band ? b2 : b
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
