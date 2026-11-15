#!/usr/bin/env node

// mpv sabitini yeni bir sürüme taşır (F0-06). Yalnızca bilerek çalıştırılır:
//
//   npm run update:mpv-pin                 # shinchiro/mpv-winbuild-cmake son sürümü
//   npm run update:mpv-pin -- 20261111     # belirli bir sürüm etiketi
//
// GitHub API'den yalnızca okur. Dosyayı indirip SHA256'sını kendisi hesaplar ve
// GitHub'ın bildirdiği özetle karşılaştırır; ikisi tutmazsa sabit değişmez.
// Sonra scripts/mpv-pin.json'u yazar. Ardından `npm run prepare:mpv:win` kurulu
// mpv'yi yeni sabite göre yeniler; değişikliği uygulamayla deneyip commit edin.

import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  PIN_FILE_URL,
  buildPinFromRelease,
  downloadWithSha256,
  fetchJson,
  pinDownloadUrl,
  validatePin
} from './mpv-lib.mjs'

const REPOSITORY = 'shinchiro/mpv-winbuild-cmake'
const API_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = Number(process.env['MPV_DOWNLOAD_TIMEOUT_MS']) || 10 * 60_000

function log(message) {
  console.log(`[update-mpv-pin] ${message}`)
}

async function main() {
  const requestedTag = process.argv[2]
  const releaseUrl = requestedTag
    ? `https://api.github.com/repos/${REPOSITORY}/releases/tags/${encodeURIComponent(requestedTag)}`
    : `https://api.github.com/repos/${REPOSITORY}/releases/latest`

  log(`${requestedTag ?? 'son sürüm'} okunuyor...`)
  const release = await fetchJson(releaseUrl, API_TIMEOUT_MS)
  const pin = buildPinFromRelease(release, REPOSITORY)

  const problems = validatePin(pin)
  if (problems.length > 0) {
    throw new Error(`Oluşan sabit geçersiz:\n- ${problems.join('\n- ')}`)
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'abi-player-mpv-pin-'))
  try {
    log(`${pin.assetName} indiriliyor (özet doğrulaması için)...`)
    const downloaded = await downloadWithSha256(
      pinDownloadUrl(pin),
      join(tempRoot, pin.assetName),
      DOWNLOAD_TIMEOUT_MS
    )

    if (downloaded.sha256 !== pin.sha256 || downloaded.size !== pin.size) {
      throw new Error(
        'İndirilen dosya GitHub’ın bildirdiğiyle eşleşmiyor; sabit değiştirilmedi.\n' +
          `  GitHub:  sha256=${pin.sha256} boyut=${pin.size}\n` +
          `  indirme: sha256=${downloaded.sha256} boyut=${downloaded.size}`
      )
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }

  let previous
  try {
    previous = JSON.parse(await readFile(PIN_FILE_URL, 'utf8'))
  } catch {
    previous = null
  }

  await writeFile(PIN_FILE_URL, `${JSON.stringify(pin, null, 2)}\n`)

  if (previous?.sha256 === pin.sha256) {
    log(`Sabit zaten güncel: ${pin.releaseTag} ${pin.assetName}`)
  } else {
    log(`Sabit güncellendi: ${previous?.releaseTag ?? '(yok)'} -> ${pin.releaseTag}`)
    log(`  ${pin.assetName}`)
    log(`  sha256 ${pin.sha256}`)
    log('Sonraki adım: npm run prepare:mpv:win, uygulamayı deneyin, scripts/mpv-pin.json dosyasını commit edin.')
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[update-mpv-pin] Hata: ${message}`)
  process.exit(1)
})
