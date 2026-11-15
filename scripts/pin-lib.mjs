// Sabitlenmiş ikililer (mpv F0-06, ffmpeg F3-07) için ortak mantık: sabit
// dosyasının denetimi, GitHub sürüm dosyasının özeti, indirme sırasında SHA256
// hesabı ve kurulu kaynağın sabitle karşılaştırılması. Saf işlevler birim
// testleriyle denenir; ağ yardımcıları zaman aşımıyla çalışır.

import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { readFile } from 'fs/promises'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'

export const USER_AGENT = 'abi-player-build'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

export function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function getAssetSha256(asset) {
  if (!isObject(asset) || typeof asset.digest !== 'string') return null
  if (!asset.digest.startsWith('sha256:')) return null
  const sha256 = asset.digest.slice('sha256:'.length).trim().toLowerCase()
  return SHA256_PATTERN.test(sha256) ? sha256 : null
}

/** `extensions`: izin verilen arşiv uzantıları, noktasız (ör. ['7z']). */
export function validatePinShape(pin, { fileName, extensions }) {
  const problems = []
  if (!isObject(pin)) return [`${fileName} bir nesne değil`]

  if (typeof pin.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(pin.repository)) {
    problems.push('repository "sahip/depo" biçiminde olmalı')
  }
  if (typeof pin.releaseTag !== 'string' || !pin.releaseTag.trim()) {
    problems.push('releaseTag boş')
  }
  const assetPattern = new RegExp(`^[\\w.-]+\\.(${extensions.join('|')})$`)
  if (typeof pin.assetName !== 'string' || !assetPattern.test(pin.assetName)) {
    problems.push(`assetName bir .${extensions.join(' / .')} dosya adı olmalı`)
  }
  if (typeof pin.sha256 !== 'string' || !SHA256_PATTERN.test(pin.sha256)) {
    problems.push('sha256 64 haneli küçük harf onaltılık olmalı')
  }
  if (!Number.isInteger(pin.size) || pin.size <= 0) {
    problems.push('size pozitif tam sayı olmalı')
  }

  return problems
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/

/**
 * Sabitlenmiş ikilinin derlendiği kaynakların kaydı (`pin.sources`): her
 * anahtar için GitHub deposu ve tam commit. THIRD-PARTY-NOTICES.md ve sürüm
 * betiğinin yüklediği kaynak arşivleri bu kayda dayanır; tek doğruluk kaynağı
 * burasıdır. `keys`: zorunlu anahtarlar.
 */
export function validatePinSources(sources, keys) {
  if (!isObject(sources)) return ['sources bir nesne değil (kaynak commit kaydı eksik)']
  const problems = []
  for (const key of keys) {
    const entry = sources[key]
    if (!isObject(entry)) {
      problems.push(`sources.${key} eksik`)
      continue
    }
    if (typeof entry.repository !== 'string' || !REPOSITORY_PATTERN.test(entry.repository)) {
      problems.push(`sources.${key}.repository "sahip/depo" biçiminde olmalı`)
    }
    if (typeof entry.commit !== 'string' || !COMMIT_PATTERN.test(entry.commit)) {
      problems.push(`sources.${key}.commit 40 haneli küçük harf onaltılık olmalı`)
    }
  }
  for (const key of Object.keys(sources)) {
    if (!keys.includes(key)) problems.push(`sources.${key} beklenmiyor`)
  }
  return problems
}

/** GitHub'da kısa bir commit'i tam commit'e çevirir; sonuç onunla başlamalı. */
export async function resolveShortCommit(repository, shortHash, timeoutMs) {
  const commit = await fetchJson(
    `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(shortHash)}`,
    timeoutMs
  )
  const sha = isObject(commit) && typeof commit.sha === 'string' ? commit.sha.toLowerCase() : ''
  if (!COMMIT_PATTERN.test(sha) || !sha.startsWith(shortHash.toLowerCase())) {
    throw new Error(`${repository}@${shortHash} tam bir commit'e çözülemedi.`)
  }
  return sha
}

/** Bir sürüm etiketinin işaret ettiği commit (açıklamalı etiket de çözülür). */
export async function resolveTagCommit(repository, tag, timeoutMs) {
  const api = `https://api.github.com/repos/${repository}/git`
  let object = (await fetchJson(`${api}/ref/tags/${encodeURIComponent(tag)}`, timeoutMs))?.object
  for (let depth = 0; isObject(object) && object.type === 'tag' && depth < 5; depth++) {
    object = (await fetchJson(`${api}/tags/${object.sha}`, timeoutMs))?.object
  }
  const sha = isObject(object) && object.type === 'commit' && typeof object.sha === 'string' ? object.sha : ''
  if (!COMMIT_PATTERN.test(sha)) throw new Error(`${repository} etiketi ${tag} bir commit'e çözülemedi.`)
  return sha
}

export function pinDownloadUrl(pin) {
  return `https://github.com/${pin.repository}/releases/download/${encodeURIComponent(pin.releaseTag)}/${encodeURIComponent(pin.assetName)}`
}

/** Kurulu ikili, ancak kaydı sabitle aynı kaynağı gösteriyorsa kabul edilir. */
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

/** Seçilen sürüm dosyasından sabit; GitHub özet bildirmiyorsa hata. */
export function pinFromAsset(asset, releaseTag, repository) {
  const sha256 = getAssetSha256(asset)
  if (!sha256) {
    throw new Error(`${asset.name} için GitHub bir sha256 özeti bildirmiyor; sabitlenemez.`)
  }
  return { repository, releaseTag, assetName: asset.name, size: asset.size, sha256 }
}

export async function readPinFile(url, validate) {
  const pin = JSON.parse(await readFile(url, 'utf8'))
  const problems = validate(pin)
  if (problems.length > 0) {
    const name = url.pathname.split('/').pop()
    throw new Error(`scripts/${name} geçersiz:\n- ${problems.join('\n- ')}`)
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
