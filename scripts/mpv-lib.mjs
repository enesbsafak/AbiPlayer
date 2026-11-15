// mpv sabitlemesi (F0-06). prepare-mpv-win.mjs sabitlenmiş sürümü kurar,
// update-mpv-pin.mjs sabiti yeni bir sürüme taşır. Ortak parçalar pin-lib.mjs'te.

import { isObject, pinFromAsset, readPinFile, validatePinShape, validatePinSources } from './pin-lib.mjs'

export {
  USER_AGENT,
  buildSourceInfo,
  downloadWithSha256,
  fetchJson,
  getAssetSha256,
  pinDownloadUrl,
  sourceMatchesPin
} from './pin-lib.mjs'

export const PIN_FILE_URL = new URL('./mpv-pin.json', import.meta.url)
export const SOURCE_FILE_NAME = '.mpv-source.json'

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

/**
 * `pin.sources` anahtarları: mpv, mpv.exe'ye gömülü FFmpeg ve derleme
 * betikleri (shinchiro/mpv-winbuild-cmake, sürüm etiketinin commit'i).
 */
export const MPV_SOURCE_KEYS = ['mpv', 'ffmpeg', 'buildScripts']
export const MPV_UPSTREAM_REPOSITORY = 'mpv-player/mpv'
export const FFMPEG_UPSTREAM_REPOSITORY = 'FFmpeg/FFmpeg'

export function validatePin(pin) {
  const problems = validatePinShape(pin, { fileName: 'mpv-pin.json', extensions: ['7z'] })
  if (!isObject(pin)) return problems
  return [...problems, ...validatePinSources(pin.sources, MPV_SOURCE_KEYS)]
}

/**
 * Sürümün dosya adlarındaki kısa commit'ler: mpv arşivinden (`…-git-<h>.7z`)
 * mpv'nin, aynı sürümdeki `ffmpeg-x86_64-git-<h>.7z` dosyasından mpv'ye gömülü
 * FFmpeg'in. İkisi de aynı derleme çalışmasının ürünüdür.
 */
export function mpvSourceShortHashes(release, assetName) {
  const mpv = /-git-([0-9a-f]{7,40})\.7z$/.exec(assetName)?.[1]
  const assets = isObject(release) && Array.isArray(release.assets) ? release.assets : []
  const ffmpeg = assets
    .map((asset) => (isObject(asset) && typeof asset.name === 'string' ? asset.name : ''))
    .map((name) => /^ffmpeg-x86_64-git-([0-9a-f]{7,40})\.7z$/.exec(name)?.[1])
    .find(Boolean)
  if (!mpv) throw new Error(`${assetName} adında mpv commit'i yok.`)
  if (!ffmpeg) throw new Error("Sürümde ffmpeg-x86_64-git-<commit>.7z dosyası yok; gömülü FFmpeg commit'i bulunamadı.")
  return { mpv, ffmpeg }
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
  return pinFromAsset(asset, release.tag_name, repository)
}

export function readPin() {
  return readPinFile(PIN_FILE_URL, validatePin)
}
