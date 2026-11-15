// mpv sabitlemesi (F0-06). prepare-mpv-win.mjs sabitlenmiş sürümü kurar,
// update-mpv-pin.mjs sabiti yeni bir sürüme taşır. Ortak parçalar pin-lib.mjs'te.

import { isObject, pinFromAsset, readPinFile, validatePinShape } from './pin-lib.mjs'

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

export function validatePin(pin) {
  return validatePinShape(pin, { fileName: 'mpv-pin.json', extensions: ['7z'] })
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
