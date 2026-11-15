import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { gzipSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { readFfmpegPin } from './ffmpeg-lib.mjs'
import { readPin as readMpvPin } from './mpv-lib.mjs'
import {
  assetSha256,
  buildDefaultNotes,
  checkVersionSync,
  describeReleaseFiles,
  humanizeCommitSubject,
  inferPrerelease,
  isAssetIntact,
  orderForUpload,
  parseArgs,
  parseGitHubRepo,
  parseUpdateManifest,
  publishRelease,
  remoteTagProblem,
  replaceCommitTerms,
  resolveRemoteTagCommit,
  sourceArchiveProblem,
  sourceArchivesFromPins,
  sourceTarballUrl,
  tarballCommit,
  verifyRemoteAssets,
  verifyUpdateManifest
} from './release-lib.mjs'

describe('parseArgs', () => {
  it('varsayılanları döner', () => {
    expect(parseArgs([])).toMatchObject({
      draft: false,
      dryRun: false,
      push: true,
      skipBuild: false,
      stable: false,
      notesFile: null,
      help: false
    })
  })

  it('bayrakları ve iki biçimdeki değerleri okur', () => {
    const options = parseArgs([
      '--draft',
      '--no-push',
      '--dry-run',
      '--skip-build',
      '--stable',
      '--allow-dirty-tracked',
      '--notes-file',
      'docs/notes.md',
      '--repo=owner/name',
      '--name',
      'Abi Player',
      '--target=main'
    ])
    expect(options).toMatchObject({
      draft: true,
      push: false,
      dryRun: true,
      skipBuild: true,
      stable: true,
      allowDirtyTracked: true,
      notesFile: 'docs/notes.md',
      repo: 'owner/name',
      name: 'Abi Player',
      target: 'main'
    })
  })

  it('--help süreç sonlandırmaz, bayrak döner', () => {
    expect(parseArgs(['-h']).help).toBe(true)
  })

  it('bilinmeyen argümanı ve eksik değeri reddeder', () => {
    expect(() => parseArgs(['--publish'])).toThrow(/Unknown argument/)
    expect(() => parseArgs(['--notes-file'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--notes-file', '--draft'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--repo='])).toThrow(/needs a value/)
    expect(() => parseArgs(['--repo', 'not-a-repo'])).toThrow(/owner\/repo/)
  })
})

describe('inferPrerelease / parseGitHubRepo', () => {
  it('beta, alpha ve rc ön sürümdür; --stable bunu ezer', () => {
    expect(inferPrerelease('0.4.15-beta', false)).toBe(true)
    expect(inferPrerelease('1.0.0-rc.1', false)).toBe(true)
    expect(inferPrerelease('1.0.0', false)).toBe(false)
    expect(inferPrerelease('0.4.15-beta', true)).toBe(false)
  })

  it('https ve ssh uzak adreslerini çözer', () => {
    expect(parseGitHubRepo('https://github.com/enesbsafak/AbiPlayer.git')).toBe('enesbsafak/AbiPlayer')
    expect(parseGitHubRepo('git@github.com:owner/my.repo.git')).toBe('owner/my.repo')
    expect(parseGitHubRepo('https://github.com/owner/repo')).toBe('owner/repo')
    expect(() => parseGitHubRepo('https://gitlab.com/owner/repo.git')).toThrow()
  })
})

describe('checkVersionSync', () => {
  const pkg = { name: 'abi-player', version: '0.4.15-beta' }
  const lock = (version, rootVersion = version) => ({
    name: 'abi-player',
    version,
    packages: { '': { name: 'abi-player', version: rootVersion } }
  })

  it('eşleşen sürümleri kabul eder', () => {
    expect(checkVersionSync(pkg, lock('0.4.15-beta'))).toEqual([])
  })

  it('geride kalmış kilit dosyasını reddeder', () => {
    const problems = checkVersionSync(pkg, lock('0.4.8-beta'))
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/0\.4\.8-beta/)
  })

  it('yalnızca packages[""] farklıysa da reddeder', () => {
    expect(checkVersionSync(pkg, lock('0.4.15-beta', '0.4.14-beta'))).toHaveLength(1)
  })

  it('geçersiz sürümü reddeder', () => {
    expect(checkVersionSync({ name: 'abi-player', version: 'next' }, lock('next'))[0]).toMatch(
      /semver/
    )
  })
})

describe('uzak etiket', () => {
  const head = 'a'.repeat(40)
  const other = 'b'.repeat(40)
  const tagObject = 'c'.repeat(40)

  it('açıklamalı etikette commit satırını tercih eder', () => {
    const output = `${tagObject}\trefs/tags/v1.0.0\n${head}\trefs/tags/v1.0.0^{}\n`
    expect(resolveRemoteTagCommit(output, 'v1.0.0')).toBe(head)
  })

  it('hafif etikette doğrudan satırı kullanır', () => {
    expect(resolveRemoteTagCommit(`${head}\trefs/tags/v1.0.0`, 'v1.0.0')).toBe(head)
  })

  it('başka etiketleri karıştırmaz', () => {
    expect(resolveRemoteTagCommit(`${head}\trefs/tags/v1.0.0-beta`, 'v1.0.0')).toBeNull()
  })

  it('--no-push için yokluğu ve başka commit’i bildirir', () => {
    expect(remoteTagProblem('', 'v1.0.0', head)).toMatch(/does not exist on origin/)
    expect(remoteTagProblem(`${other}\trefs/tags/v1.0.0`, 'v1.0.0', head)).toMatch(/points at/)
    expect(remoteTagProblem(`${head}\trefs/tags/v1.0.0`, 'v1.0.0', head)).toBeNull()
  })
})

describe('latest.yml', () => {
  const manifest = [
    'version: 0.4.15-beta',
    'files:',
    '  - url: abi-player-0.4.15-beta-setup.exe',
    '    sha512: SHA==',
    '    size: 1234',
    'path: abi-player-0.4.15-beta-setup.exe',
    'sha512: SHA==',
    "releaseDate: '2026-11-15T10:00:00.000Z'",
    ''
  ].join('\r\n')

  const expected = {
    version: '0.4.15-beta',
    installerName: 'abi-player-0.4.15-beta-setup.exe',
    installerSize: 1234,
    installerSha512: 'SHA=='
  }

  it('electron-builder biçimini ayrıştırır', () => {
    expect(parseUpdateManifest(manifest)).toEqual({
      version: '0.4.15-beta',
      path: 'abi-player-0.4.15-beta-setup.exe',
      sha512: 'SHA==',
      releaseDate: '2026-11-15T10:00:00.000Z',
      files: [{ url: 'abi-player-0.4.15-beta-setup.exe', sha512: 'SHA==', size: '1234' }]
    })
  })

  it('tutarlı dosyayı kabul eder', () => {
    expect(verifyUpdateManifest(manifest, expected)).toEqual([])
  })

  it('sürüm, boyut ve sha512 uyuşmazlıklarını bildirir', () => {
    expect(verifyUpdateManifest(manifest, { ...expected, version: '0.4.16-beta' })).toHaveLength(1)
    expect(verifyUpdateManifest(manifest, { ...expected, installerSize: 99 })).toEqual([
      expect.stringMatching(/size/)
    ])
    expect(verifyUpdateManifest(manifest, { ...expected, installerSha512: 'OTHER==' })).toHaveLength(2)
    expect(
      verifyUpdateManifest(manifest, { ...expected, installerName: 'abi-player-0.4.16-beta-setup.exe' })
    ).toHaveLength(2)
  })
})

describe('sürüm notu çevirisi', () => {
  it('tam kelimeleri bir kez çevirir (F5-11)', () => {
    expect(replaceCommitTerms('categories')).toBe('kategoriler')
    expect(replaceCommitTerms('category')).toBe('kategori')
    expect(replaceCommitTerms('updater')).toBe('güncelleyici')
    expect(replaceCommitTerms('updates')).toBe('güncellemeler')
    expect(replaceCommitTerms('players')).toBe('oynatıcılar')
    expect(replaceCommitTerms('catalogs')).toBe('kataloglar')
    expect(replaceCommitTerms('release notes')).toBe('sürüm notları')
  })

  it('kelime içindeki parçalara dokunmaz', () => {
    expect(replaceCommitTerms('imagery')).toBe('imagery')
    expect(replaceCommitTerms('build')).toBe('build')
    expect(replaceCommitTerms('quit')).toBe('quit')
    expect(replaceCommitTerms('güi')).toBe('güi')
  })

  it('büyük harfli ve kısa çizgili girdileri çevirir', () => {
    expect(replaceCommitTerms('Categories list')).toBe('kategoriler list')
    expect(replaceCommitTerms('MPV-player')).toBe('MPV-oynatıcı')
  })

  it('fiil önekini çeviriden önce ayırır', () => {
    expect(humanizeCommitSubject('chore: update updater')).toBe('Güncelleyici güncellendi')
    expect(humanizeCommitSubject('feat: add categories filter')).toBe('Kategoriler filter eklendi')
    expect(humanizeCommitSubject('fix(player): spinner stuck')).toBe(
      'Yükleniyor göstergesi stuck düzeltildi'
    )
    expect(humanizeCommitSubject('feat(katalog): kaldığın yerden devam et')).toBe(
      'Kaldığın yerden devam et'
    )
  })

  it('varsayılan notlar release: commitlerini atlar ve yasal notu ekler', () => {
    const notes = buildDefaultNotes('0.4.16-beta', [
      'release: v0.4.15-beta [x]',
      'feat(destek): destek sekmesi'
    ])
    expect(notes).toContain('- Destek sekmesi')
    expect(notes).not.toContain('release:')
    expect(notes).toContain('Yasal Not')
  })
})

describe('yükleme sırası ve doğrulama', () => {
  it('latest.yml en sona gider', () => {
    expect(orderForUpload(['latest.yml', 'a.exe', 'a.exe.blockmap'])).toEqual([
      'a.exe',
      'a.exe.blockmap',
      'latest.yml'
    ])
  })

  it('eksik, yarım, boyutu tutmayan ve fazladan varlıkları bildirir', () => {
    const files = [
      { name: 'a.exe', size: 10 },
      { name: 'a.exe.blockmap', size: 2 },
      { name: 'latest.yml', size: 3 }
    ]
    expect(
      verifyRemoteAssets(
        [
          { name: 'a.exe', size: 10, state: 'uploaded' },
          { name: 'a.exe.blockmap', size: 2, state: 'uploaded' },
          { name: 'latest.yml', size: 3, state: 'uploaded' }
        ],
        files
      )
    ).toEqual([])

    const problems = verifyRemoteAssets(
      [
        { name: 'a.exe', size: 9, state: 'uploaded' },
        { name: 'a.exe.blockmap', size: 2, state: 'starter' },
        { name: 'old.exe', size: 1, state: 'uploaded' }
      ],
      files
    )
    expect(problems).toHaveLength(4)
  })
})

describe('publishRelease', () => {
  const manifestContent = Buffer.from('version: 1\n')
  const files = describeReleaseFiles([
    { name: 'a.exe', path: 'dist/a.exe', content: Buffer.from('installer!') },
    { name: 'a.exe.blockmap', path: 'dist/a.exe.blockmap', content: Buffer.from('bm') },
    { name: 'latest.yml', path: 'dist/latest.yml', content: manifestContent }
  ])

  // GitHub computes the digest from the uploaded bytes; the fake takes it from
  // the file's sha256, which describeReleaseFiles derived from its content.
  function fakeApi({ existing = null, failUploadOf = null, corruptManifest = false, assets: seeded = [] } = {}) {
    const calls = []
    let release = existing
    const assets = new Map(seeded.map((asset) => [asset.name, asset]))
    let nextId = 100

    const api = {
      calls,
      async findReleaseByTag(tag) {
        calls.push(['find', tag])
        return release
      },
      async createRelease(payload) {
        calls.push(['create', payload])
        release = { id: 1, html_url: 'https://example.test/r/1', tag_name: payload.tag_name, ...payload }
        return release
      },
      async updateRelease(id, payload) {
        calls.push(['update', id, payload])
        release = { ...release, ...payload }
        return release
      },
      async listAssets() {
        return [...assets.values()]
      },
      async deleteAsset(id) {
        calls.push(['delete', id])
        for (const [name, asset] of assets) if (asset.id === id) assets.delete(name)
      },
      async uploadFiles(_release, batch) {
        calls.push(['upload', batch.map((file) => file.name)])
        for (const file of batch) {
          if (file.name === failUploadOf) throw new Error(`upload of ${file.name} failed`)
          assets.set(file.name, {
            id: nextId++,
            name: file.name,
            size: file.size,
            state: 'uploaded',
            digest: `sha256:${file.sha256}`,
            content: file.content
          })
        }
      },
      async downloadAsset(asset) {
        calls.push(['download', asset.name])
        if (corruptManifest) return Buffer.from('version: 2\n')
        return asset.content ?? Buffer.alloc(0)
      }
    }
    return api
  }

  const base = {
    tag: 'v1.0.0-beta',
    targetCommitish: 'a'.repeat(40),
    releaseName: 'Abi Player v1.0.0-beta',
    notes: 'notes',
    prerelease: true,
    files
  }

  it('taslak oluşturur, latest.yml’i en son yükler, doğrular ve sonra yayınlar', async () => {
    const api = fakeApi()
    const result = await publishRelease({ ...base, api, keepDraft: false })

    expect(result.draft).toBe(false)
    const kinds = api.calls.map((call) => call[0])
    expect(kinds).toEqual(['find', 'create', 'upload', 'upload', 'download', 'update'])
    expect(api.calls[1][1]).toMatchObject({ draft: true, tag_name: 'v1.0.0-beta', prerelease: true })
    expect(api.calls[2][1]).toEqual(['a.exe', 'a.exe.blockmap'])
    expect(api.calls[3][1]).toEqual(['latest.yml'])
    expect(api.calls[5][2]).toEqual({ draft: false })
  })

  it('--draft ile yayınlamaz', async () => {
    const api = fakeApi()
    const result = await publishRelease({ ...base, api, keepDraft: true })
    expect(result.draft).toBe(true)
    expect(api.calls.some((call) => call[0] === 'update')).toBe(false)
  })

  it('yükleme hatasında taslak kalır ve latest.yml hiç gitmez', async () => {
    const api = fakeApi({ failUploadOf: 'a.exe' })
    await expect(publishRelease({ ...base, api, keepDraft: false })).rejects.toThrow(/upload of a.exe/)
    expect(api.calls.some((call) => call[0] === 'update')).toBe(false)
    expect(api.calls.filter((call) => call[0] === 'upload')).toHaveLength(1)
  })

  it('sunucudaki latest.yml farklıysa yayınlamaz', async () => {
    const api = fakeApi({ corruptManifest: true })
    await expect(publishRelease({ ...base, api, keepDraft: false })).rejects.toThrow(
      /stays a draft[\s\S]*latest\.yml on GitHub differs/
    )
    expect(api.calls.some((call) => call[0] === 'update')).toBe(false)
  })

  it('yayınlanmış sürüme dokunmaz', async () => {
    const api = fakeApi({ existing: { id: 7, draft: false, html_url: 'https://example.test/r/7' } })
    await expect(publishRelease({ ...base, api, keepDraft: false })).rejects.toThrow(/already published/)
    expect(api.calls.map((call) => call[0])).toEqual(['find'])
  })

  it('var olan taslağı sürdürür, sağlam varlıkları atlar', async () => {
    const api = fakeApi({ existing: { id: 7, draft: true, tag_name: 'v1.0.0-beta', html_url: 'x' } })
    await api.uploadFiles(null, [files[0]])
    api.calls.length = 0

    await publishRelease({ ...base, api, keepDraft: false })
    const uploads = api.calls.filter((call) => call[0] === 'upload').map((call) => call[1])
    expect(uploads).toEqual([['a.exe.blockmap'], ['latest.yml']])
    expect(api.calls[1]).toEqual(['update', 7, expect.objectContaining({ draft: true })])
  })

  // Regression (M4): an existing asset used to count as intact by its size
  // alone, so a rebuilt installer of the same size was kept.
  describe('resuming after a rebuild', () => {
    const draft = { id: 7, draft: true, tag_name: 'v1.0.0-beta', html_url: 'x' }
    const sha256 = (text) => createHash('sha256').update(text).digest('hex')

    function staleAsset(id, file, content) {
      return { id, name: file.name, size: content.length, state: 'uploaded', digest: `sha256:${sha256(content)}`, content }
    }

    it('replaces an asset of the same size whose bytes differ, and publishes a matching release', async () => {
      // Same size as the local installer ("installer!"), other bytes.
      const staleInstaller = Buffer.from('INSTALLER?')
      expect(staleInstaller.length).toBe(files[0].size)
      const api = fakeApi({
        existing: { ...draft },
        assets: [
          staleAsset(1, files[0], staleInstaller),
          staleAsset(2, files[1], Buffer.from('bm')),
          staleAsset(3, files[2], Buffer.from('version: 0\n'))
        ]
      })

      const result = await publishRelease({ ...base, api, keepDraft: false })

      expect(result.draft).toBe(false)
      expect(api.calls.filter((call) => call[0] === 'delete')).toEqual([
        ['delete', 1],
        ['delete', 3]
      ])
      const uploads = api.calls.filter((call) => call[0] === 'upload').map((call) => call[1])
      expect(uploads).toEqual([['a.exe'], ['latest.yml']])
      const remote = await api.listAssets()
      for (const file of files) {
        expect(assetSha256(remote.find((asset) => asset.name === file.name))).toBe(file.sha256)
      }
    })

    it('replaces an asset whose digest GitHub does not report', async () => {
      const { digest: _digest, ...withoutDigest } = staleAsset(1, files[0], Buffer.from('installer!'))
      const api = fakeApi({ existing: { ...draft }, assets: [withoutDigest] })
      await publishRelease({ ...base, api, keepDraft: true })
      expect(api.calls).toContainEqual(['delete', 1])
      expect(api.calls.filter((call) => call[0] === 'upload')[0][1]).toContain('a.exe')
    })

    it('a run that failed after a rebuild converges on the next run', async () => {
      const oldFiles = describeReleaseFiles([
        { name: 'a.exe', path: 'dist/a.exe', content: Buffer.from('OLDINSTALL') },
        { name: 'a.exe.blockmap', path: 'dist/a.exe.blockmap', content: Buffer.from('bm') },
        { name: 'latest.yml', path: 'dist/latest.yml', content: Buffer.from('version: 0.9\n') }
      ])
      const api = fakeApi()
      await publishRelease({ ...base, files: oldFiles, api, keepDraft: true })

      // Rebuild: the installer keeps its size, latest.yml changes; the upload
      // of latest.yml fails, so the draft is left half replaced.
      const failing = fakeApi({ existing: { ...draft }, assets: await api.listAssets(), failUploadOf: 'latest.yml' })
      await expect(publishRelease({ ...base, api: failing, keepDraft: false })).rejects.toThrow(/latest\.yml/)

      const resumed = fakeApi({ existing: { ...draft }, assets: await failing.listAssets() })
      const result = await publishRelease({ ...base, api: resumed, keepDraft: false })
      expect(result.draft).toBe(false)
      const remote = await resumed.listAssets()
      expect(remote.map((asset) => asset.name).sort()).toEqual(['a.exe', 'a.exe.blockmap', 'latest.yml'])
      for (const file of files) {
        expect(assetSha256(remote.find((asset) => asset.name === file.name))).toBe(file.sha256)
      }
      // The installer already matched after the failed run; only latest.yml is sent again.
      expect(resumed.calls.filter((call) => call[0] === 'upload').map((call) => call[1])).toEqual([['latest.yml']])
    })
  })

  it('does not publish when a verified asset differs from the local file', async () => {
    const api = fakeApi()
    const original = api.uploadFiles
    api.uploadFiles = async (release, batch) => {
      await original(release, batch)
      const installer = (await api.listAssets()).find((asset) => asset.name === 'a.exe')
      if (installer) installer.digest = `sha256:${'0'.repeat(64)}`
    }
    await expect(publishRelease({ ...base, api, keepDraft: false })).rejects.toThrow(
      /stays a draft[\s\S]*a\.exe on GitHub differs from the local file/
    )
    expect(api.calls.some((call) => call[0] === 'update')).toBe(false)
  })
})

describe('varlık özeti', () => {
  const file = { name: 'a.exe', size: 3, sha256: 'ab'.repeat(32) }

  it('GitHub’ın sha256 özetini okur', () => {
    expect(assetSha256({ digest: `sha256:${'AB'.repeat(32)}` })).toBe('ab'.repeat(32))
    expect(assetSha256({ digest: 'sha512:abc' })).toBeNull()
    expect(assetSha256({})).toBeNull()
    expect(assetSha256(undefined)).toBeNull()
  })

  it('varlığı yalnızca içeriği yerel dosyayla aynıysa sağlam sayar', () => {
    const asset = { state: 'uploaded', size: 3, digest: `sha256:${file.sha256}` }
    expect(isAssetIntact(asset, file)).toBe(true)
    expect(isAssetIntact({ ...asset, digest: `sha256:${'cd'.repeat(32)}` }, file)).toBe(false)
    expect(isAssetIntact({ ...asset, digest: undefined }, file)).toBe(false)
    expect(isAssetIntact({ ...asset, size: 4 }, file)).toBe(false)
    expect(isAssetIntact({ ...asset, state: 'starter' }, file)).toBe(false)
    expect(isAssetIntact(asset, { ...file, sha256: undefined })).toBe(false)
    expect(isAssetIntact(undefined, file)).toBe(false)
  })

  it('dosyaların boyutunu ve sha256’sını içerikten hesaplar; içeriği yalnızca latest.yml taşır', () => {
    const [installer, manifest] = describeReleaseFiles([
      { name: 'a.exe', path: 'dist/a.exe', content: Buffer.from('abc') },
      { name: 'latest.yml', path: 'dist/latest.yml', content: Buffer.from('v') }
    ])
    expect(installer).toEqual({
      name: 'a.exe',
      path: 'dist/a.exe',
      size: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    })
    expect(manifest.content).toEqual(Buffer.from('v'))
  })
})

// ---------------------------------------------------------------------------
// Kaynak arşivleri

/** `git archive` gibi: pax genel başlığı (commit `comment` kaydında), sonra bir dosya. */
function fakeTarball(commit, { typeflag = 'g', name = 'pax_global_header' } = {}) {
  const header = (entryName, size, flag) => {
    const block = Buffer.alloc(512)
    block.write(entryName, 0, 'utf8')
    block.write(size.toString(8).padStart(11, '0'), 124, 'utf8')
    block.write(flag, 156, 'utf8')
    return block
  }
  const record = `52 comment=${commit}\n`
  const body = Buffer.alloc(512)
  body.write(record, 0, 'utf8')
  return gzipSync(
    Buffer.concat([header(name, record.length, typeflag), body, header('repo-abc/README', 0, '0'), Buffer.alloc(1024)])
  )
}

const MPV_PIN = {
  repository: 'shinchiro/mpv-winbuild-cmake',
  releaseTag: '20261111',
  assetName: 'mpv-x86_64-20261111-git-bcde6b93cc.7z',
  sources: {
    mpv: { repository: 'mpv-player/mpv', commit: 'bcde6b93cca4d128d84e1a60d1a6db2cd81c889e' },
    ffmpeg: { repository: 'FFmpeg/FFmpeg', commit: 'cd4e96eb314630788b7ff2f9820c395788c023e2' },
    buildScripts: { repository: 'shinchiro/mpv-winbuild-cmake', commit: 'bda10a2816ce9908d419b3f4b564227330457e76' }
  }
}
const FFMPEG_PIN = {
  repository: 'FFmpeg-Builds/FFmpeg-Builds',
  releaseTag: 'autobuild-2026-10-31-12-59',
  assetName: 'ffmpeg-n9.0.2-39-g7adfbe40dc-win64-gpl-shared-9.0.zip',
  sources: {
    ffmpeg: { repository: 'FFmpeg/FFmpeg', commit: '7adfbe40dcde598f93a6963d2f7b22cd75202ccc' },
    buildScripts: { repository: 'FFmpeg-Builds/FFmpeg-Builds', commit: '5031c6f1082414e53688d39e521849905071070d' }
  }
}

describe('sourceArchivesFromPins', () => {
  it('0.5.0-beta sürümüne elle yüklenen beş arşivin adlarını ve commitlerini verir', () => {
    expect(sourceArchivesFromPins(MPV_PIN, FFMPEG_PIN)).toEqual([
      { name: 'source-mpv-bcde6b93cc.tar.gz', ...MPV_PIN.sources.mpv },
      { name: 'source-ffmpeg-n9.0.2-39-g7adfbe40dc.tar.gz', ...FFMPEG_PIN.sources.ffmpeg },
      { name: 'source-ffmpeg-in-mpv-cd4e96eb3.tar.gz', ...MPV_PIN.sources.ffmpeg },
      { name: 'source-mpv-build-scripts-20261111.tar.gz', ...MPV_PIN.sources.buildScripts },
      { name: 'source-ffmpeg-build-scripts-2026-10-31.tar.gz', ...FFMPEG_PIN.sources.buildScripts }
    ])
    expect(sourceTarballUrl(sourceArchivesFromPins(MPV_PIN, FFMPEG_PIN)[0])).toBe(
      'https://api.github.com/repos/mpv-player/mpv/tarball/bcde6b93cca4d128d84e1a60d1a6db2cd81c889e'
    )
  })

  it('dosya adındaki kısa commit kayıtlı commitle uyuşmazsa ya da kayıt yoksa durur', () => {
    const otherMpv = {
      ...MPV_PIN,
      sources: { ...MPV_PIN.sources, mpv: { ...MPV_PIN.sources.mpv, commit: 'a'.repeat(40) } }
    }
    expect(() => sourceArchivesFromPins(otherMpv, FFMPEG_PIN)).toThrow(/sources\.mpv\.commit/)
    const otherFfmpeg = {
      ...FFMPEG_PIN,
      sources: { ...FFMPEG_PIN.sources, ffmpeg: { ...FFMPEG_PIN.sources.ffmpeg, commit: 'b'.repeat(40) } }
    }
    expect(() => sourceArchivesFromPins(MPV_PIN, otherFfmpeg)).toThrow(/sources\.ffmpeg\.commit/)
    expect(() => sourceArchivesFromPins({ ...MPV_PIN, sources: undefined }, FFMPEG_PIN)).toThrow(/sources/)
  })
})

describe('tarballCommit / sourceArchiveProblem', () => {
  const archive = { name: 'source-x.tar.gz', repository: 'o/r', commit: 'c'.repeat(40) }

  it('git archive çıktısının pax başlığından commiti okur', () => {
    expect(tarballCommit(fakeTarball('c'.repeat(40)))).toBe('c'.repeat(40))
    expect(sourceArchiveProblem(fakeTarball('c'.repeat(40)), archive)).toBeNull()
  })

  it('başka committen, gzip olmayan ya da pax başlığı olmayan arşivi reddeder', () => {
    expect(sourceArchiveProblem(fakeTarball('d'.repeat(40)), archive)).toMatch(/made from d{40}, expected c{40}/)
    expect(tarballCommit(Buffer.from('<html>rate limited</html>'))).toBeNull()
    expect(tarballCommit(fakeTarball('c'.repeat(40), { typeflag: '0', name: 'README' }))).toBeNull()
    expect(sourceArchiveProblem(Buffer.alloc(0), archive)).toMatch(/not a GitHub source archive/)
  })
})

describe('kaynak arşivleriyle yayın', () => {
  it('arşivleri kurulum dosyasıyla yükler, latest.yml yine en son gider ve hepsi doğrulanır', async () => {
    const files = describeReleaseFiles([
      { name: 'latest.yml', path: 'dist/latest.yml', content: Buffer.from('version: 1\n') },
      { name: 'a.exe', path: 'dist/a.exe', content: Buffer.from('installer!') },
      { name: 'source-mpv-bcde6b93cc.tar.gz', path: 'dist/source-archives/m.tar.gz', content: fakeTarball('c'.repeat(40)) }
    ])
    const uploads = []
    const assets = new Map()
    let release = null
    const api = {
      findReleaseByTag: async () => release,
      createRelease: async (payload) => (release = { id: 1, html_url: 'x', ...payload }),
      updateRelease: async (_id, payload) => (release = { ...release, ...payload }),
      listAssets: async () => [...assets.values()],
      deleteAsset: async () => {},
      uploadFiles: async (_release, batch) => {
        uploads.push(batch.map((file) => file.name))
        for (const file of batch) {
          assets.set(file.name, {
            id: assets.size + 1,
            name: file.name,
            size: file.size,
            state: 'uploaded',
            digest: `sha256:${file.sha256}`,
            content: file.content
          })
        }
      },
      downloadAsset: async (asset) => asset.content
    }
    const published = await publishRelease({
      api,
      tag: 'v1.0.0',
      targetCommitish: 'a'.repeat(40),
      releaseName: 'r',
      notes: 'n',
      prerelease: false,
      keepDraft: false,
      files
    })
    expect(published.draft).toBe(false)
    expect(uploads).toEqual([['a.exe', 'source-mpv-bcde6b93cc.tar.gz'], ['latest.yml']])
  })
})

describe('THIRD-PARTY-NOTICES.md ve sabitler', () => {
  it('bildirimler, sabitlerdeki her ikiliyi ve her kaynak commitini aynen anar', async () => {
    const notices = readFileSync(new URL('../THIRD-PARTY-NOTICES.md', import.meta.url), 'utf8')
    const mpvPin = await readMpvPin()
    const ffmpegPin = await readFfmpegPin()
    const missing = []
    for (const pin of [mpvPin, ffmpegPin]) {
      for (const value of [pin.releaseTag, pin.assetName, pin.sha256, String(pin.size)]) {
        if (!notices.includes(value)) missing.push(value)
      }
    }
    for (const archive of sourceArchivesFromPins(mpvPin, ffmpegPin)) {
      for (const value of [archive.name, archive.commit, archive.repository]) {
        if (!notices.includes(value)) missing.push(value)
      }
    }
    expect(missing).toEqual([])
  })
})
