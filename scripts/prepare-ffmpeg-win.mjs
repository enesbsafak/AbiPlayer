#!/usr/bin/env node

// Pakete giren ffmpeg ve ffprobe'u kurar (F3-07). Kaynak her zaman
// scripts/ffmpeg-pin.json'daki sabittir; indirilen arşiv sabitteki boyut ve
// SHA256 ile tutmazsa derleme durur. Arşivden yalnızca ffmpeg.exe, ffprobe.exe,
// paylaşımlı kitaplıkları ve lisans metni alınır; kurulum
// resources/ffmpeg/win32-x64'e atomik olarak taşınır (install-pinned.mjs).
// Sabiti yeni yapıya taşımak için: npm run update:ffmpeg-pin

import { copyFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { FFMPEG_SOURCE_FILE_NAME, isRuntimeFile, readFfmpegPin } from './ffmpeg-lib.mjs'
import { findDirectoryContainingFile, firstLine, installPinned, run } from './install-pinned.mjs'

const TARGET_DIR = join(process.cwd(), 'resources', 'ffmpeg', 'win32-x64')
const FORCE_DOWNLOAD = process.env['FORCE_FFMPEG_DOWNLOAD'] === '1'
const DOWNLOAD_TIMEOUT_MS = Number(process.env['FFMPEG_DOWNLOAD_TIMEOUT_MS']) || 10 * 60_000
const VERSION_CHECK_TIMEOUT_MS = 30_000

function log(message) {
  console.log(`[prepare-ffmpeg] ${message}`)
}

async function main() {
  if (process.platform !== 'win32') {
    log('Windows dışı ortamda ffmpeg hazırlama atlandı.')
    return
  }

  await installPinned({
    name: 'FFmpeg',
    pin: await readFfmpegPin(),
    targetDir: TARGET_DIR,
    markerFile: 'ffprobe.exe',
    sourceFileName: FFMPEG_SOURCE_FILE_NAME,
    force: FORCE_DOWNLOAD,
    downloadTimeoutMs: DOWNLOAD_TIMEOUT_MS,
    busyHint: 'ffmpeg veya ffprobe çalışıyor olabilir.',
    log,
    async stage(extractDir, stagingDir) {
      const binDir = await findDirectoryContainingFile(extractDir, 'ffprobe.exe')
      if (!binDir) throw new Error('Arşivde ffprobe.exe bulunamadı.')
      const files = (await readdir(binDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && isRuntimeFile(entry.name))
        .map((entry) => entry.name)
      if (!files.some((name) => name.toLowerCase() === 'ffmpeg.exe')) {
        throw new Error('Arşivde ffmpeg.exe bulunamadı.')
      }
      for (const name of files) await copyFile(join(binDir, name), join(stagingDir, name))

      // GPL yapısı: lisans metni ikililerle birlikte dağıtılır.
      const license = join(dirname(binDir), 'LICENSE.txt')
      if (!existsSync(license)) throw new Error('Arşivde LICENSE.txt bulunamadı.')
      await copyFile(license, join(stagingDir, 'LICENSE.txt'))
    },
    async verify(stagingDir) {
      const lines = []
      for (const tool of ['ffmpeg', 'ffprobe']) {
        const output = await run(join(stagingDir, `${tool}.exe`), ['-hide_banner', '-version'], {
          timeoutMs: VERSION_CHECK_TIMEOUT_MS
        })
        lines.push(firstLine(output, `${tool} -version çalıştı`))
      }
      return lines
    }
  })
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[prepare-ffmpeg] Hata: ${message}`)
  process.exit(1)
})
