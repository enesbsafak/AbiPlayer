// Renders the Abi Player icon and installer artwork from build/brand/*.svg.
//   build/icon.png               1024 px, from the master
//   build/icon.ico               256/128/64/48 from the master, 32/24/16 from the small variant
//   build/installerSidebar.bmp   164 x 314, 24-bit
//   build/installerHeader.bmp    150 x 57, 24-bit
// Run with `npm run make:icons`. The rasteriser is sharp (libvips + librsvg).
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const build = join(root, 'build')
const GROUND = '#15121C'

const masterSvg = await readFile(join(build, 'brand', 'icon.svg'))
const smallSvg = await readFile(join(build, 'brand', 'icon-small.svg'), 'utf8')

const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: (72 * size) / 1024 })
    .resize(size, size)
    .png()
    .toBuffer()

/** Raw BGRA rows for a ICO DIB entry, bottom-up, plus the AND mask. */
async function dibEntry(png, size) {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // height counts the AND mask too
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = ((size - 1 - y) * size + x) * 4
      const d = (y * size + x) * 4
      xor[d] = data[s + 2]
      xor[d + 1] = data[s + 1]
      xor[d + 2] = data[s]
      xor[d + 3] = data[s + 3]
    }
  }
  const maskRow = Math.ceil(size / 32) * 4
  return Buffer.concat([header, xor, Buffer.alloc(maskRow * size)])
}

/** PNG-compressed entry for 256 px, classic DIB for the rest (NSIS-safe). */
async function buildIco(entries) {
  const images = []
  for (const { size, png } of entries) {
    images.push({ size, data: size >= 256 ? png : await dibEntry(png, size) })
  }
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  images.forEach(({ size, data }, i) => {
    const o = i * 16
    dir[o] = size >= 256 ? 0 : size
    dir[o + 1] = size >= 256 ? 0 : size
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([head, dir, ...images.map((i) => i.data)])
}

/** 24-bit uncompressed BMP from a flattened RGB sharp pipeline. */
async function toBmp(pipeline) {
  const { data, info } = await pipeline.flatten({ background: GROUND }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const stride = Math.ceil((width * 3) / 4) * 4
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 3
      const d = (height - 1 - y) * stride + x * 3
      pixels[d] = data[s + 2]
      pixels[d + 1] = data[s + 1]
      pixels[d + 2] = data[s]
    }
  }
  const head = Buffer.alloc(54)
  head.write('BM', 0)
  head.writeUInt32LE(54 + pixels.length, 2)
  head.writeUInt32LE(54, 10)
  head.writeUInt32LE(40, 14)
  head.writeInt32LE(width, 18)
  head.writeInt32LE(height, 22)
  head.writeUInt16LE(1, 26)
  head.writeUInt16LE(24, 28)
  head.writeUInt32LE(pixels.length, 34)
  head.writeInt32LE(2835, 38)
  head.writeInt32LE(2835, 42)
  return Buffer.concat([head, pixels])
}

// The mark alone: the small variant without its ground, cropped to the grid.
const markSvg = smallSvg
  .replace(/^\s*<rect width="1024"[^\n]*\n/m, '')
  .replace('viewBox="0 0 1024 1024"', 'viewBox="140 140 744 744"')
  .replace('width="1024" height="1024"', 'width="744" height="744"')
const markPng = (px) => sharp(Buffer.from(markSvg), { density: (72 * px) / 744 }).resize(px, px).png().toBuffer()

const canvas = (width, height, overlaySvg, layers) =>
  sharp({ create: { width, height, channels: 4, background: GROUND } }).composite([
    ...(overlaySvg ? [{ input: Buffer.from(overlaySvg) }] : []),
    ...layers
  ])

async function main() {
  await mkdir(build, { recursive: true })

  await writeFile(join(build, 'icon.png'), await render(masterSvg, 1024))

  const entries = []
  for (const size of [256, 128, 64, 48]) entries.push({ size, png: await render(masterSvg, size) })
  for (const size of [32, 24, 16]) entries.push({ size, png: await render(smallSvg, size) })
  await writeFile(join(build, 'icon.ico'), await buildIco(entries))

  // Sidebar: mark in the upper third, bubbles cut off by the lower edges.
  const bubbles = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314">
    <circle cx="150" cy="300" r="118" fill="#fff" fill-opacity=".10"/>
    <circle cx="8" cy="262" r="74" fill="#fff" fill-opacity=".08"/>
    <circle cx="98" cy="352" r="62" fill="#fff" fill-opacity=".13"/>
  </svg>`
  const sidebar = canvas(164, 314, bubbles, [{ input: await markPng(96), left: 34, top: 40 }])
  await writeFile(join(build, 'installerSidebar.bmp'), await toBmp(sidebar))

  // Header: mark at the right, vertically centred.
  const header = canvas(150, 57, null, [{ input: await markPng(36), left: 150 - 36 - 12, top: Math.round((57 - 36) / 2) }])
  await writeFile(join(build, 'installerHeader.bmp'), await toBmp(header))

  console.log('icons written to', build)
}

await main()
