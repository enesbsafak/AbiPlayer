import { describe, expect, it } from 'vitest'
import {
  buildDefaultNotes,
  checkVersionSync,
  humanizeCommitSubject,
  inferPrerelease,
  orderForUpload,
  parseArgs,
  parseGitHubRepo,
  parseUpdateManifest,
  publishRelease,
  remoteTagProblem,
  replaceCommitTerms,
  resolveRemoteTagCommit,
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
  const files = [
    { name: 'a.exe', path: 'dist/a.exe', size: 10 },
    { name: 'a.exe.blockmap', path: 'dist/a.exe.blockmap', size: 2 },
    { name: 'latest.yml', path: 'dist/latest.yml', size: manifestContent.length, content: manifestContent }
  ]

  function fakeApi({ existing = null, failUploadOf = null, corruptManifest = false } = {}) {
    const calls = []
    let release = existing
    const assets = new Map()

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
          assets.set(file.name, { id: assets.size + 100, name: file.name, size: file.size, state: 'uploaded' })
        }
      },
      async downloadAsset(asset) {
        calls.push(['download', asset.name])
        return corruptManifest ? Buffer.from('version: 2\n') : manifestContent
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
})
