import { describe, expect, it } from 'vitest'
import {
  buildPinFromRelease,
  buildSourceInfo,
  getAssetSha256,
  mpvSourceShortHashes,
  pickMpvAsset,
  pinDownloadUrl,
  readPin,
  sourceMatchesPin,
  validatePin
} from './mpv-lib.mjs'

const SHA = 'f'.repeat(64)

const pin = {
  repository: 'shinchiro/mpv-winbuild-cmake',
  releaseTag: '20261111',
  assetName: 'mpv-x86_64-20261111-git-bcde6b93cc.7z',
  size: 1234,
  sha256: SHA
}

const sources = {
  mpv: { repository: 'mpv-player/mpv', commit: 'bcde6b93cca4d128d84e1a60d1a6db2cd81c889e' },
  ffmpeg: { repository: 'FFmpeg/FFmpeg', commit: 'cd4e96eb314630788b7ff2f9820c395788c023e2' },
  buildScripts: { repository: 'shinchiro/mpv-winbuild-cmake', commit: 'bda10a2816ce9908d419b3f4b564227330457e76' }
}

describe('pickMpvAsset', () => {
  const names = [
    'mpv-aarch64-20261111-git-bcde6b93cc.7z',
    'mpv-dev-x86_64-20261111-git-bcde6b93cc.7z',
    'mpv-x86_64-v3-20261111-git-bcde6b93cc.7z',
    'mpv-x86_64-20261111-git-bcde6b93cc.7z',
    'mpv-debug-x86_64-20261111-git-bcde6b93cc.7z'
  ]

  it('v3, dev ve debug olmayan x86_64 arşivini seçer', () => {
    expect(pickMpvAsset(names.map((name) => ({ name })))?.name).toBe(
      'mpv-x86_64-20261111-git-bcde6b93cc.7z'
    )
  })

  it('uygun dosya yoksa null döner', () => {
    expect(pickMpvAsset([{ name: 'ffmpeg-x86_64.7z' }, null, { name: 3 }])).toBeNull()
  })
})

describe('getAssetSha256', () => {
  it('sha256: önekini ayıklar ve biçimi denetler', () => {
    expect(getAssetSha256({ digest: `sha256:${'A'.repeat(64)}` })).toBe('a'.repeat(64))
    expect(getAssetSha256({ digest: 'sha512:abc' })).toBeNull()
    expect(getAssetSha256({ digest: 'sha256:kısa' })).toBeNull()
    expect(getAssetSha256({})).toBeNull()
  })
})

describe('validatePin', () => {
  it('geçerli sabiti kabul eder', () => {
    expect(validatePin({ ...pin, sources })).toEqual([])
  })

  it('eksik veya bozuk alanları bildirir', () => {
    const pinned = { ...pin, sources }
    expect(validatePin({ ...pinned, sha256: 'ABC' })).toHaveLength(1)
    expect(validatePin({ ...pinned, assetName: '../evil.exe' })).toHaveLength(1)
    expect(validatePin({ ...pinned, size: 0 })).toHaveLength(1)
    expect(validatePin({ ...pinned, repository: 'bad' })).toHaveLength(1)
    expect(validatePin(null)).toHaveLength(1)
  })

  it('kaynak commit kaydını ister (mpv, gömülü FFmpeg, derleme betikleri)', () => {
    expect(validatePin(pin)).toEqual(['sources bir nesne değil (kaynak commit kaydı eksik)'])
    expect(validatePin({ ...pin, sources: { ...sources, ffmpeg: undefined } })).toEqual(['sources.ffmpeg eksik'])
    expect(validatePin({ ...pin, sources: { ...sources, mpv: { repository: 'x', commit: 'bcde6b93cc' } } })).toHaveLength(2)
  })

  it('depodaki sabit geçerlidir', async () => {
    await expect(readPin()).resolves.toMatchObject({ repository: 'shinchiro/mpv-winbuild-cmake' })
  })
})

describe('kurulu kaynak kaydı', () => {
  it('aynı sabitten kurulanı kabul eder', () => {
    expect(sourceMatchesPin(buildSourceInfo(pin), pin)).toBe(true)
  })

  it('eski sürümü, başka dosyayı veya kaydı olmayanı reddeder', () => {
    expect(sourceMatchesPin({ ...buildSourceInfo(pin), releaseTag: '20250101' }, pin)).toBe(false)
    expect(sourceMatchesPin({ ...buildSourceInfo(pin), sha256: 'e'.repeat(64) }, pin)).toBe(false)
    // Sabitlemeden önceki betiğin yazdığı kayıt: sha256 null olabiliyordu.
    expect(sourceMatchesPin({ ...buildSourceInfo(pin), sha256: null }, pin)).toBe(false)
    expect(sourceMatchesPin(null, pin)).toBe(false)
  })

  it('indirme adresini sabitten türetir', () => {
    expect(pinDownloadUrl(pin)).toBe(
      'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261111/mpv-x86_64-20261111-git-bcde6b93cc.7z'
    )
    expect(buildSourceInfo(pin, new Date('2026-11-15T00:00:00Z')).installedAt).toBe(
      '2026-11-15T00:00:00.000Z'
    )
  })
})

describe('buildPinFromRelease', () => {
  const release = {
    tag_name: '20261111',
    assets: [
      { name: 'mpv-x86_64-v3-20261111-git-bcde6b93cc.7z', size: 1, digest: `sha256:${'1'.repeat(64)}` },
      { name: pin.assetName, size: 1234, digest: `sha256:${SHA}` }
    ]
  }

  it('bugünkü seçim kuralıyla sabit üretir', () => {
    expect(buildPinFromRelease(release, pin.repository)).toEqual(pin)
  })

  it('mpv ve gömülü FFmpeg için kısa commitleri dosya adlarından okur', () => {
    const withFfmpeg = { ...release, assets: [...release.assets, { name: 'ffmpeg-x86_64-git-cd4e96eb3.7z' }] }
    expect(mpvSourceShortHashes(withFfmpeg, pin.assetName)).toEqual({ mpv: 'bcde6b93cc', ffmpeg: 'cd4e96eb3' })
    expect(() => mpvSourceShortHashes(release, pin.assetName)).toThrow(/gömülü FFmpeg/)
  })

  it('özet bildirilmemişse sabitlemez', () => {
    const noDigest = { ...release, assets: [{ name: pin.assetName, size: 1234 }] }
    expect(() => buildPinFromRelease(noDigest, pin.repository)).toThrow(/sha256/)
  })
})
