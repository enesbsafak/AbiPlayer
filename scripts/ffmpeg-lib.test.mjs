import { describe, expect, it } from 'vitest'
import {
  FFMPEG_REPOSITORY,
  buildFfmpegPinFromRelease,
  isLongLivedTag,
  isRuntimeFile,
  pickFfmpegAsset,
  pickLongLivedRelease,
  readFfmpegPin,
  validateFfmpegPin
} from './ffmpeg-lib.mjs'

const SHA = 'a'.repeat(64)
const ASSET = 'ffmpeg-n9.0.2-39-g7adfbe40dc-win64-gpl-shared-9.0.zip'

const assets = [
  { name: 'ffmpeg-N-128227-g4811625b5f-win64-gpl-shared.zip', size: 1, digest: `sha256:${'1'.repeat(64)}` },
  { name: 'ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-shared-8.1.zip', size: 2, digest: `sha256:${'2'.repeat(64)}` },
  { name: 'ffmpeg-n9.0.2-39-g7adfbe40dc-win64-lgpl-shared-9.0.zip', size: 3, digest: `sha256:${'3'.repeat(64)}` },
  { name: 'ffmpeg-n9.0.2-39-g7adfbe40dc-win64-gpl-9.0.zip', size: 4, digest: `sha256:${'4'.repeat(64)}` },
  { name: 'ffmpeg-n9.0.2-39-g7adfbe40dc-linux64-gpl-shared-9.0.tar.xz', size: 5 },
  { name: ASSET, size: 1234, digest: `sha256:${SHA}` }
]

describe('pickFfmpegAsset', () => {
  it('en yeni sürüm dalının win64 GPL paylaşımlı arşivini seçer', () => {
    expect(pickFfmpegAsset(assets)?.name).toBe(ASSET)
  })

  it('ana daldan (N-) ve başka biçimlerden yapı seçmez', () => {
    expect(pickFfmpegAsset(assets.slice(0, 1))).toBeNull()
    expect(pickFfmpegAsset([null, { name: 7 }, ...assets.slice(2, 5)])).toBeNull()
  })

  it('sürümleri sayı olarak karşılaştırır', () => {
    const picked = pickFfmpegAsset([
      { name: 'ffmpeg-n10.0-1-gabc-win64-gpl-shared-10.0.zip' },
      { name: 'ffmpeg-n9.10.1-1-gabc-win64-gpl-shared-9.10.zip' }
    ])
    expect(picked?.name).toBe('ffmpeg-n10.0-1-gabc-win64-gpl-shared-10.0.zip')
  })
})

describe('isLongLivedTag', () => {
  it('yalnızca ay sonu yapılarını kalıcı sayar', () => {
    expect(isLongLivedTag('autobuild-2026-10-31-12-59')).toBe(true)
    expect(isLongLivedTag('autobuild-2026-09-30-13-08')).toBe(true)
    expect(isLongLivedTag('autobuild-2028-02-29-12-00')).toBe(true)
    expect(isLongLivedTag('autobuild-2026-02-28-12-59')).toBe(true)
    expect(isLongLivedTag('autobuild-2026-11-14-12-37')).toBe(false)
    expect(isLongLivedTag('autobuild-2026-09-31-12-00')).toBe(false)
    expect(isLongLivedTag('latest')).toBe(false)
  })
})

describe('pickLongLivedRelease', () => {
  it('günlük yapıları ve "latest" etiketini atlar', () => {
    const releases = [
      { tag_name: 'latest', assets },
      { tag_name: 'autobuild-2026-11-14-12-37', assets },
      { tag_name: 'autobuild-2026-10-31-12-59', assets: assets.slice(0, 1) },
      { tag_name: 'autobuild-2026-09-30-13-08', assets }
    ]
    expect(pickLongLivedRelease(releases)?.tag_name).toBe('autobuild-2026-09-30-13-08')
    expect(pickLongLivedRelease([])).toBeNull()
  })
})

describe('buildFfmpegPinFromRelease', () => {
  it('ay sonu yapısından sabit üretir', () => {
    expect(buildFfmpegPinFromRelease({ tag_name: 'autobuild-2026-10-31-12-59', assets }, FFMPEG_REPOSITORY)).toEqual({
      repository: FFMPEG_REPOSITORY,
      releaseTag: 'autobuild-2026-10-31-12-59',
      assetName: ASSET,
      size: 1234,
      sha256: SHA
    })
  })

  it('günlük yapıyı veya özetsiz dosyayı sabitlemez', () => {
    expect(() =>
      buildFfmpegPinFromRelease({ tag_name: 'autobuild-2026-11-14-12-37', assets }, FFMPEG_REPOSITORY)
    ).toThrow(/ay sonu/)
    expect(() =>
      buildFfmpegPinFromRelease(
        { tag_name: 'autobuild-2026-10-31-12-59', assets: [{ name: ASSET, size: 1 }] },
        FFMPEG_REPOSITORY
      )
    ).toThrow(/sha256/)
  })
})

describe('ffmpeg sabiti', () => {
  it('zip dışındaki arşivi reddeder', () => {
    const pin = { repository: FFMPEG_REPOSITORY, releaseTag: 't', assetName: ASSET, size: 1, sha256: SHA }
    expect(validateFfmpegPin(pin)).toEqual([])
    expect(validateFfmpegPin({ ...pin, assetName: 'ffmpeg.7z' })).toHaveLength(1)
  })

  it('depodaki sabit geçerlidir ve ay sonu yapısına bağlıdır', async () => {
    const pin = await readFfmpegPin()
    expect(pin.repository).toBe(FFMPEG_REPOSITORY)
    expect(isLongLivedTag(pin.releaseTag)).toBe(true)
  })
})

describe('isRuntimeFile', () => {
  it('iki aracı ve kitaplıkları alır, ffplay ile geliştirme dosyalarını almaz', () => {
    for (const name of ['ffmpeg.exe', 'ffprobe.exe', 'avcodec-63.dll', 'SWSCALE-10.DLL']) {
      expect(isRuntimeFile(name)).toBe(true)
    }
    for (const name of ['ffplay.exe', 'avcodec.lib', 'libavcodec.dll.a', 'avcodec-63.def', 'LICENSE.txt']) {
      expect(isRuntimeFile(name)).toBe(false)
    }
  })
})
