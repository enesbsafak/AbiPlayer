#!/usr/bin/env node

// Pakete giren mpv'yi kurar (F0-06). Kaynak her zaman scripts/mpv-pin.json'daki
// sabittir: sürüm etiketi, dosya adı, boyut ve SHA256 depoda durur. İndirilen
// dosya bu özetle tutmazsa derleme durur. Kurulum resources/mpv/win32-x64'e
// atomik olarak taşınır (install-pinned.mjs). Sabiti yeni sürüme taşımak için:
// npm run update:mpv-pin

import { cp } from 'fs/promises'
import { join } from 'path'
import { findDirectoryContainingFile, firstLine, installPinned, run } from './install-pinned.mjs'
import { SOURCE_FILE_NAME, readPin } from './mpv-lib.mjs'

const TARGET_DIR = join(process.cwd(), 'resources', 'mpv', 'win32-x64')
const FORCE_DOWNLOAD = process.env['FORCE_MPV_DOWNLOAD'] === '1'
const DOWNLOAD_TIMEOUT_MS = Number(process.env['MPV_DOWNLOAD_TIMEOUT_MS']) || 10 * 60_000
const VERSION_CHECK_TIMEOUT_MS = 30_000

function log(message) {
  console.log(`[prepare-mpv] ${message}`)
}

async function main() {
  if (process.platform !== 'win32') {
    log('Windows dışı ortamda MPV hazırlama atlandı.')
    return
  }

  await installPinned({
    name: 'MPV',
    pin: await readPin(),
    targetDir: TARGET_DIR,
    markerFile: 'mpv.exe',
    sourceFileName: SOURCE_FILE_NAME,
    force: FORCE_DOWNLOAD,
    downloadTimeoutMs: DOWNLOAD_TIMEOUT_MS,
    busyHint: 'mpv çalışıyor olabilir.',
    log,
    async stage(extractDir, stagingDir) {
      const mpvDir = await findDirectoryContainingFile(extractDir, 'mpv.exe')
      if (!mpvDir) throw new Error('Arşivde mpv.exe bulunamadı.')
      await cp(mpvDir, stagingDir, { recursive: true })
    },
    async verify(stagingDir) {
      const output = await run(join(stagingDir, 'mpv.exe'), ['--version'], {
        timeoutMs: VERSION_CHECK_TIMEOUT_MS
      })
      return [firstLine(output, 'mpv --version çalıştı')]
    }
  })
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[prepare-mpv] Hata: ${message}`)
  process.exit(1)
})
