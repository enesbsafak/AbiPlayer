#!/usr/bin/env node

// ffmpeg sabitini yeni bir yapıya taşır (F3-07). Yalnızca bilerek çalıştırılır:
//
//   npm run update:ffmpeg-pin                                  # en yeni ay sonu yapısı
//   npm run update:ffmpeg-pin -- autobuild-2026-10-31-12-59    # belirli bir etiket
//
// Yalnızca ay sonu yapıları kabul edilir: FFmpeg-Builds günlük yapıları birkaç
// gün sonra siler, ay sonu yapıları kalır. GitHub API'den yalnızca okur;
// dosyayı indirip SHA256'sını kendisi hesaplar ve GitHub'ın bildirdiği özetle
// karşılaştırır, tutmazsa sabit değişmez. Ardından `npm run prepare:ffmpeg:win`
// kurulu ffmpeg'i yeni sabite göre yeniler; uçtan uca testleri çalıştırıp
// scripts/ffmpeg-pin.json dosyasını commit edin.

import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  FFMPEG_PIN_FILE_URL,
  FFMPEG_REPOSITORY,
  buildFfmpegPinFromRelease,
  ffmpegVersionOf,
  pickLongLivedRelease,
  validateFfmpegPin
} from './ffmpeg-lib.mjs'
import { FFMPEG_UPSTREAM_REPOSITORY } from './mpv-lib.mjs'
import { downloadWithSha256, fetchJson, pinDownloadUrl, resolveShortCommit, resolveTagCommit } from './pin-lib.mjs'

const API_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = Number(process.env['FFMPEG_DOWNLOAD_TIMEOUT_MS']) || 10 * 60_000

function log(message) {
  console.log(`[update-ffmpeg-pin] ${message}`)
}

async function findRelease(requestedTag) {
  const api = `https://api.github.com/repos/${FFMPEG_REPOSITORY}/releases`
  if (requestedTag) return fetchJson(`${api}/tags/${encodeURIComponent(requestedTag)}`, API_TIMEOUT_MS)

  const releases = await fetchJson(`${api}?per_page=100`, API_TIMEOUT_MS)
  const release = pickLongLivedRelease(Array.isArray(releases) ? releases : [])
  if (!release) throw new Error('Son 100 sürümde uygun dosyası olan ay sonu yapısı yok.')
  return release
}

async function main() {
  const requestedTag = process.argv[2]
  log(`${requestedTag ?? 'en yeni ay sonu yapısı'} okunuyor...`)
  const release = await findRelease(requestedTag)
  const pin = buildFfmpegPinFromRelease(release, FFMPEG_REPOSITORY)

  // Kaynak commit'leri (THIRD-PARTY-NOTICES.md ve sürüm betiğinin kaynak
  // arşivleri bunlara dayanır): FFmpeg dosya adındaki sürümden, derleme
  // betikleri sürüm etiketinden.
  const { shortHash } = ffmpegVersionOf(pin.assetName)
  pin.sources = {
    ffmpeg: {
      repository: FFMPEG_UPSTREAM_REPOSITORY,
      commit: await resolveShortCommit(FFMPEG_UPSTREAM_REPOSITORY, shortHash, API_TIMEOUT_MS)
    },
    buildScripts: {
      repository: FFMPEG_REPOSITORY,
      commit: await resolveTagCommit(FFMPEG_REPOSITORY, pin.releaseTag, API_TIMEOUT_MS)
    }
  }

  const problems = validateFfmpegPin(pin)
  if (problems.length > 0) {
    throw new Error(`Oluşan sabit geçersiz:\n- ${problems.join('\n- ')}`)
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'abi-player-ffmpeg-pin-'))
  try {
    log(`${pin.assetName} indiriliyor (özet doğrulaması için)...`)
    const downloaded = await downloadWithSha256(pinDownloadUrl(pin), join(tempRoot, pin.assetName), DOWNLOAD_TIMEOUT_MS)

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
    previous = JSON.parse(await readFile(FFMPEG_PIN_FILE_URL, 'utf8'))
  } catch {
    previous = null
  }

  await writeFile(FFMPEG_PIN_FILE_URL, `${JSON.stringify(pin, null, 2)}\n`)

  if (previous?.sha256 === pin.sha256) {
    log(`Sabit zaten güncel: ${pin.releaseTag} ${pin.assetName}`)
  } else {
    log(`Sabit güncellendi: ${previous?.releaseTag ?? '(yok)'} -> ${pin.releaseTag}`)
    log(`  ${pin.assetName}`)
    log(`  sha256 ${pin.sha256}`)
    log(`  kaynak: FFmpeg ${pin.sources.ffmpeg.commit}, betikler ${pin.sources.buildScripts.commit}`)
    log("Sonraki adım: npm run prepare:ffmpeg:win, npm run test:e2e, THIRD-PARTY-NOTICES.md bölüm 2'yi güncelleyin, scripts/ffmpeg-pin.json dosyasını commit edin.")
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[update-ffmpeg-pin] Hata: ${message}`)
  process.exit(1)
})
