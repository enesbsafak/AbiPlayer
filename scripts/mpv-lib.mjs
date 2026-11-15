// mpv sabitlemesi (F0-06) için ortak mantık. prepare-mpv-win.mjs sabitlenmiş
// sürümü kurar, update-mpv-pin.mjs sabiti yeni bir sürüme taşır. Saf işlevler
// birim testleriyle denenir; ağ yardımcıları zaman aşımıyla çalışır.

import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { readFile } from 'fs/promises'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'

export const PIN_FILE_URL = new URL('./mpv-pin.json', import.meta.url)
export const SOURCE_FILE_NAME = '.mpv-source.json'
export const USER_AGENT = 'abi-player-build'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Bugüne kadar seçilen dosya: x86_64, v3 olmayan, debug/dev olmayan .7z. */
export function pickMpvAsset(assets) {
  return (
    assets.find((asset) => {
      if (!isObject(asset) || typeof asset.name !== 'string') return false
      return (
        asset.name.startsWith('mpv-x86_64-') &&
        asset.name.endsWith('.7z') &&
        !asset.name.includes('-v3-') &&
        !asset.name.includes('debug') &&
        !asset.name.includes('dev')
      )
    }) ?? null
  )
}

export function getAssetSha256(asset) {
  if (!isObject(asset) || typeof asset.digest !== 'string') return null
  if (!asset.digest.startsWith('sha256:')) return null
  const sha256 = asset.digest.slice('sha256:'.length).trim().toLowerCase()
  return SHA256_PATTERN.test(sha256) ? sha256 : null
}

export function validatePin(pin) {
  const problems = []
  if (!isObject(pin)) return ['mpv-pin.json bir nesne değil']

  if (typeof pin.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(pin.repository)) {
    problems.push('repository "sahip/depo" biçiminde olmalı')
  }
  if (typeof pin.releaseTag !== 'string' || !pin.releaseTag.trim()) {
    problems.push('releaseTag boş')
  }
  if (typeof pin.assetName !== 'string' || !/^[\w.-]+\.7z$/.test(pin.assetName)) {
    problems.push('assetName bir .7z dosya adı olmalı')
  }
  if (typeof pin.sha256 !== 'string' || !SHA256_PATTERN.test(pin.sha256)) {
    problems.push('sha256 64 haneli küçük harf onaltılık olmalı')
  }
  if (!Number.isInteger(pin.size) || pin.size <= 0) {
    problems.push('size pozitif tam sayı olmalı')
  }

  return problems
}

export function pinDownloadUrl(pin) {
  return `https://github.com/${pin.repository}/releases/download/${encodeURIComponent(pin.releaseTag)}/${encodeURIComponent(pin.assetName)}`
}

/** Kurulu mpv, ancak kaydı sabitle aynı kaynağı gösteriyorsa kabul edilir. */
export function sourceMatchesPin(source, pin) {
  return (
    isObject(source) &&
    source.repository === pin.repository &&
    source.releaseTag === pin.releaseTag &&
    source.assetName === pin.assetName &&
    typeof source.sha256 === 'string' &&
    source.sha256.toLowerCase() === pin.sha256
  )
}

export function buildSourceInfo(pin, now = new Date()) {
  return {
    repository: pin.repository,
    releaseTag: pin.releaseTag,
    assetName: pin.assetName,
    assetUrl: pinDownloadUrl(pin),
    sha256: pin.sha256,
    size: pin.size,
    installedAt: now.toISOString()
  }
}

/** GitHub sürüm yanıtından sabit taslağı; özet bildirilmemişse hata. */
export function buildPinFromRelease(release, repository) {
  if (!isObject(release) || typeof release.tag_name !== 'string') {
    throw new Error('GitHub yanıtında tag_name yok.')
  }
  const asset = pickMpvAsset(Array.isArray(release.assets) ? release.assets : [])
  if (!asset) {
    throw new Error(`${release.tag_name} sürümünde uygun x64 mpv dosyası yok.`)
  }
  const sha256 = getAssetSha256(asset)
  if (!sha256) {
    throw new Error(`${asset.name} için GitHub bir sha256 özeti bildirmiyor; sabitlenemez.`)
  }

  return {
    repository,
    releaseTag: release.tag_name,
    assetName: asset.name,
    size: asset.size,
    sha256
  }
}

export async function readPin() {
  const pin = JSON.parse(await readFile(PIN_FILE_URL, 'utf8'))
  const problems = validatePin(pin)
  if (problems.length > 0) {
    throw new Error(`scripts/mpv-pin.json geçersiz:\n- ${problems.join('\n- ')}`)
  }
  return pin
}

export async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) {
    throw new Error(`GitHub API hatası (${response.status}): ${response.statusText}`)
  }
  return response.json()
}

/**
 * Dosyayı indirirken SHA256'sını hesaplar. Zaman aşımı bağlantı ve gövdenin
 * tamamı için geçerlidir. Dönen değer: { sha256, size }.
 */
export async function downloadWithSha256(url, destinationPath, timeoutMs) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { Accept: 'application/octet-stream', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs)
  })

  if (!response.ok || !response.body) {
    throw new Error(`Dosya indirilemedi (${response.status}): ${response.statusText}`)
  }

  const hash = createHash('sha256')
  let size = 0
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      size += chunk.length
      callback(null, chunk)
    }
  })

  await pipeline(Readable.fromWeb(response.body), hasher, createWriteStream(destinationPath))
  return { sha256: hash.digest('hex'), size }
}
