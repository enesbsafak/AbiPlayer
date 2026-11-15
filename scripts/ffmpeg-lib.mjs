// ffmpeg ve ffprobe sabitlemesi (F3-07). prepare-ffmpeg-win.mjs sabitlenmiş
// yapıyı kurar, update-ffmpeg-pin.mjs sabiti yeni bir yapıya taşır.
//
// Kaynak: FFmpeg-Builds (eski adıyla BtbN/FFmpeg-Builds), Windows x64, sürüm
// dalı (nX.Y), GPL, paylaşımlı kitaplıklar. Paylaşımlı yapıda ffmpeg.exe ile
// ffprobe.exe aynı DLL'leri kullanır; durağan yapıda her biri kitaplıkların
// tamamını ayrıca taşır. Günlük yapılar yaklaşık iki hafta tutuluyor, ay sonu
// yapıları kalıcı; sabit bu yüzden yalnızca ay sonu yapısına bağlanır.

import { isObject, pinFromAsset, readPinFile, validatePinShape, validatePinSources } from './pin-lib.mjs'

export const FFMPEG_REPOSITORY = 'FFmpeg-Builds/FFmpeg-Builds'
export const FFMPEG_PIN_FILE_URL = new URL('./ffmpeg-pin.json', import.meta.url)
export const FFMPEG_SOURCE_FILE_NAME = '.ffmpeg-source.json'

const ASSET_PATTERN = /^ffmpeg-n(\d+)\.(\d+)(?:\.(\d+))?-[\w.-]*-win64-gpl-shared-\d+\.\d+\.zip$/
const TAG_PATTERN = /^autobuild-(\d{4})-(\d{2})-(\d{2})-\d{2}-\d{2}$/

function assetVersion(name) {
  const match = ASSET_PATTERN.exec(name)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/** Sürüm dalı yapıları içinden en yeni win64 GPL paylaşımlı .zip. */
export function pickFfmpegAsset(assets) {
  let best = null
  let bestVersion = null
  for (const asset of assets) {
    if (!isObject(asset) || typeof asset.name !== 'string') continue
    const version = assetVersion(asset.name)
    if (!version) continue
    if (!bestVersion || compareVersions(version, bestVersion) > 0) {
      best = asset
      bestVersion = version
    }
  }
  return best
}

/** Ay sonu yapısı mı (kalıcı tutulan): etiketteki gün ayın son günü. */
export function isLongLivedTag(tag) {
  const match = TAG_PATTERN.exec(String(tag))
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day === lastDay
}

/** Sürüm listesinden (yeniden eskiye) uygun dosyası olan en yeni ay sonu yapısı. */
export function pickLongLivedRelease(releases) {
  return (
    releases.find(
      (release) =>
        isObject(release) &&
        isLongLivedTag(release.tag_name) &&
        Array.isArray(release.assets) &&
        pickFfmpegAsset(release.assets) !== null
    ) ?? null
  )
}

/** Pakete giren dosyalar: iki araç ve paylaşımlı kitaplıkları. ffplay girmez. */
export function isRuntimeFile(name) {
  return /^(ffmpeg|ffprobe)\.exe$/i.test(name) || /\.dll$/i.test(name)
}

export function validateFfmpegPin(pin) {
  const problems = validatePinShape(pin, { fileName: 'ffmpeg-pin.json', extensions: ['zip'] })
  if (!isObject(pin)) return problems
  return [...problems, ...validatePinSources(pin.sources, FFMPEG_SOURCE_KEYS)]
}

/**
 * `pin.sources` anahtarları: kurulumdaki FFmpeg ve derleme betikleri
 * (FFmpeg-Builds, sürüm etiketinin commit'i).
 */
export const FFMPEG_SOURCE_KEYS = ['ffmpeg', 'buildScripts']

/**
 * Dosya adındaki FFmpeg sürümü ve kısa commit'i:
 * `ffmpeg-n9.0.2-39-g7adfbe40dc-win64-…` → n9.0.2-39-g7adfbe40dc, 7adfbe40dc.
 */
export function ffmpegVersionOf(assetName) {
  const match = /^ffmpeg-(n\d+(?:\.\d+)*-\d+-g([0-9a-f]{7,40}))-win64-/.exec(String(assetName))
  if (!match?.[1] || !match[2]) throw new Error(`${assetName} adında FFmpeg sürümü yok.`)
  return { version: match[1], shortHash: match[2] }
}

export function buildFfmpegPinFromRelease(release, repository) {
  if (!isObject(release) || typeof release.tag_name !== 'string') {
    throw new Error('GitHub yanıtında tag_name yok.')
  }
  if (!isLongLivedTag(release.tag_name)) {
    throw new Error(`${release.tag_name} ay sonu yapısı değil; günlük yapılar birkaç gün sonra silinir.`)
  }
  const asset = pickFfmpegAsset(Array.isArray(release.assets) ? release.assets : [])
  if (!asset) {
    throw new Error(`${release.tag_name} sürümünde win64 GPL paylaşımlı ffmpeg dosyası yok.`)
  }
  return pinFromAsset(asset, release.tag_name, repository)
}

export function readFfmpegPin() {
  return readPinFile(FFMPEG_PIN_FILE_URL, validateFfmpegPin)
}
