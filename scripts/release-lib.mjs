// release-win.mjs için saf mantık: argümanlar, sürüm notu çevirisi, latest.yml
// doğrulaması, sürüm denetimleri ve GitHub taslak → yayın akışı. Buradaki hiçbir
// işlev ağa, git'e veya dosya sistemine doğrudan dokunmaz; akış, dışarıdan verilen
// `api` nesnesi üzerinden çalışır ki birim testlerle denenebilsin.

import { createHash } from 'crypto'
import { gunzipSync } from 'zlib'
import { ffmpegVersionOf } from './ffmpeg-lib.mjs'

export const UPDATE_MANIFEST = 'latest.yml'

export const LEGAL_NOTE = [
  'Yasal Not',
  'Abi Player yalnızca bir oynatıcıdır; içerik sağlamaz, satmaz, dağıtmaz veya barındırmaz.',
  'Kullanılan kaynakların yasal uygunluğundan kullanıcı sorumludur.'
].join('\n')

// ---------------------------------------------------------------------------
// Argümanlar

const VALUE_OPTIONS = {
  '--notes-file': 'notesFile',
  '--repo': 'repo',
  '--name': 'name',
  '--target': 'target'
}

const FLAG_OPTIONS = {
  '--draft': ['draft', true],
  '--dry-run': ['dryRun', true],
  '--no-push': ['push', false],
  '--skip-build': ['skipBuild', true],
  '--stable': ['stable', true],
  '--allow-dirty-tracked': ['allowDirtyTracked', true]
}

export function parseArgs(argv) {
  const options = {
    help: false,
    draft: false,
    dryRun: false,
    push: true,
    skipBuild: false,
    stable: false,
    notesFile: null,
    repo: null,
    name: null,
    target: null,
    allowDirtyTracked: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (Object.hasOwn(FLAG_OPTIONS, arg)) {
      const [key, value] = FLAG_OPTIONS[arg]
      options[key] = value
      continue
    }

    const equalsIndex = arg.indexOf('=')
    const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex)
    if (Object.hasOwn(VALUE_OPTIONS, flag)) {
      const value = equalsIndex === -1 ? argv[++index] : arg.slice(equalsIndex + 1)
      if (value === undefined || value === '' || (equalsIndex === -1 && value.startsWith('--'))) {
        throw new Error(`${flag} needs a value.`)
      }
      options[VALUE_OPTIONS[flag]] = value
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (options.repo !== null && !/^[\w.-]+\/[\w.-]+$/.test(options.repo)) {
    throw new Error(`--repo must look like owner/repo, got: ${options.repo}`)
  }

  return options
}

export const HELP_TEXT = `Usage: npm run release:win -- [options]

Steps: version check -> unit tests -> build -> verify artifacts -> download the
source archives of the pinned mpv and FFmpeg -> resolve token -> push branch and
tag -> draft release -> upload -> verify -> publish.

Options:
  --notes-file <path>       Read release notes from a UTF-8 markdown file
  --repo <owner/repo>       Override GitHub repository
  --name <release name>     Override release title
  --target <branch>         Override the branch that is pushed
  --skip-build              Reuse existing dist artifacts (tests still run)
  --no-push                 Do not push; the tag must already be on origin at HEAD
  --draft                   Upload and verify, but leave the release as a draft
  --stable                  Force prerelease=false
  --dry-run                 Run checks, tests and build; no push, no GitHub writes
  --allow-dirty-tracked     Allow tracked git changes
`

// ---------------------------------------------------------------------------
// Sürüm ve depo denetimleri

export function inferPrerelease(version, forceStable) {
  if (forceStable) return false
  return /-(alpha|beta|rc)(?:[.-]|$)/i.test(version)
}

export function parseGitHubRepo(remoteUrl) {
  const match = remoteUrl
    .trim()
    .match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i)
  if (!match?.groups) {
    throw new Error(`Could not parse GitHub repository from remote URL: ${remoteUrl}`)
  }

  return `${match.groups.owner}/${match.groups.repo}`
}

/**
 * package-lock.json'daki sürüm package.json'dan geri kalırsa (v0.4.8 → v0.4.15
 * arasında olduğu gibi) yayın durur. Sürüm `npm version <v> --no-git-tag-version`
 * ile artırılınca ikisi birlikte güncellenir.
 */
export function checkVersionSync(packageJson, packageLock) {
  const problems = []
  const version = packageJson?.version

  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    problems.push(`package.json version is not a valid semver: ${String(version)}`)
  }
  if (packageLock?.name !== packageJson?.name) {
    problems.push(
      `package-lock.json name (${String(packageLock?.name)}) differs from package.json (${String(packageJson?.name)})`
    )
  }
  if (packageLock?.version !== version) {
    problems.push(
      `package-lock.json version (${String(packageLock?.version)}) differs from package.json (${String(version)})`
    )
  }
  const rootVersion = packageLock?.packages?.['']?.version
  if (rootVersion !== version) {
    problems.push(
      `package-lock.json packages[""].version (${String(rootVersion)}) differs from package.json (${String(version)})`
    )
  }

  return problems
}

/**
 * `git ls-remote --tags origin refs/tags/<tag> refs/tags/<tag>^{}` çıktısından
 * etiketin işaret ettiği commit'i çıkarır. Açıklamalı etikette `^{}` satırı
 * commit'i, düz satır etiket nesnesini verir; commit tercih edilir.
 */
export function resolveRemoteTagCommit(lsRemoteOutput, tag) {
  let direct = null
  let peeled = null

  for (const line of lsRemoteOutput.split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/)
    if (!sha || !ref) continue
    if (ref === `refs/tags/${tag}^{}`) peeled = sha
    else if (ref === `refs/tags/${tag}`) direct = sha
  }

  return peeled ?? direct
}

export function remoteTagProblem(lsRemoteOutput, tag, headSha) {
  const remoteSha = resolveRemoteTagCommit(lsRemoteOutput, tag)
  if (!remoteSha) {
    return `${tag} does not exist on origin. Push it first, or run without --no-push.`
  }
  if (remoteSha !== headSha) {
    return `${tag} on origin points at ${remoteSha.slice(0, 12)}, but HEAD is ${headSha.slice(0, 12)}.`
  }
  return null
}

// ---------------------------------------------------------------------------
// latest.yml

function unquote(value) {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * electron-builder'ın yazdığı latest.yml biçimi için dar bir ayrıştırıcı:
 * üst düzey `anahtar: değer` satırları ve `files:` altındaki `- url:` öğeleri.
 */
export function parseUpdateManifest(text) {
  const manifest = { files: [] }
  let currentFile = null
  let inFiles = false

  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue

    const topLevel = rawLine.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (topLevel) {
      const [, key, value] = topLevel
      inFiles = key === 'files' && value.trim() === ''
      currentFile = null
      if (!inFiles) manifest[key] = unquote(value)
      continue
    }

    if (!inFiles) continue

    const item = rawLine.match(/^\s*-\s+([A-Za-z0-9_]+):\s*(.*)$/)
    if (item) {
      currentFile = { [item[1]]: unquote(item[2]) }
      manifest.files.push(currentFile)
      continue
    }

    const field = rawLine.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/)
    if (field && currentFile) currentFile[field[1]] = unquote(field[2])
  }

  return manifest
}

/**
 * latest.yml kurulum dosyasını doğru sürüm, ad, boyut ve sha512 ile mi gösteriyor?
 * Sorun listesi döner; boş liste geçerli demektir.
 */
export function verifyUpdateManifest(text, { version, installerName, installerSize, installerSha512 }) {
  const manifest = parseUpdateManifest(text)
  const problems = []

  if (manifest.version !== version) {
    problems.push(`latest.yml version is ${String(manifest.version)}, expected ${version}`)
  }
  if (manifest.path !== installerName) {
    problems.push(`latest.yml path is ${String(manifest.path)}, expected ${installerName}`)
  }
  if (manifest.sha512 !== installerSha512) {
    problems.push('latest.yml sha512 does not match the installer')
  }

  const entry = manifest.files.find((file) => file.url === installerName)
  if (!entry) {
    problems.push(`latest.yml files[] has no entry for ${installerName}`)
  } else {
    if (Number(entry.size) !== installerSize) {
      problems.push(
        `latest.yml files[].size (${String(entry.size)}) does not match installer size (${installerSize})`
      )
    }
    if (entry.sha512 !== installerSha512) {
      problems.push('latest.yml files[].sha512 does not match the installer')
    }
  }

  return problems
}

// ---------------------------------------------------------------------------
// Sürüm notları

// Tek geçişte, tam kelime eşleşmesiyle çevrilir: önceki kural sonrakinin girdisini
// bozamaz ("updater" → "güncellemer", "players" → "oynatıcıs" gibi). Çok kelimeli
// ve uzun biçimler önce denenir.
const COMMIT_TERMS = new Map([
  ['release notes', 'sürüm notları'],
  ['release note', 'sürüm notu'],
  ['players', 'oynatıcılar'],
  ['player', 'oynatıcı'],
  ['catalogs', 'kataloglar'],
  ['catalog', 'katalog'],
  ['categories', 'kategoriler'],
  ['category', 'kategori'],
  ['images', 'görseller'],
  ['image', 'görsel'],
  ['updates', 'güncellemeler'],
  ['updater', 'güncelleyici'],
  ['update', 'güncelleme'],
  ['loading', 'yükleme'],
  ['spinners', 'yükleniyor göstergeleri'],
  ['spinner', 'yükleniyor göstergesi'],
  ['ux', 'kullanıcı deneyimi'],
  ['ui', 'arayüz'],
  ['mpv', 'MPV']
])

const COMMIT_TERM_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[...COMMIT_TERMS.keys()]
    .sort((left, right) => right.length - left.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('|')})(?![\\p{L}\\p{N}])`,
  'giu'
)

export function replaceCommitTerms(text) {
  return text.replace(COMMIT_TERM_PATTERN, (match) => {
    return COMMIT_TERMS.get(match.toLowerCase().replace(/\s+/g, ' ')) ?? match
  })
}

export function normalizeReleaseText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').normalize('NFC').trim()
}

export function splitConventionalCommit(subject) {
  const match = subject.match(/^(?<type>[a-z]+)(?:\([^)]+\))?!?:\s*(?<rest>.+)$/i)
  if (!match?.groups) {
    return { type: 'other', rest: subject.trim() }
  }

  return {
    type: match.groups.type.toLowerCase(),
    rest: match.groups.rest.trim()
  }
}

function capitalizeSentence(text) {
  if (!text) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Fiil, çeviriden önce ham metinden ayrılır; yoksa "update" önce "güncelleme"ye
// dönüşür ve fiil eki hiç eşleşmez.
const LEADING_VERBS = [
  [/^improve\s+/i, ' iyileştirildi'],
  [/^add\s+/i, ' eklendi'],
  [/^fix\s+/i, ' düzeltildi'],
  [/^update\s+/i, ' güncellendi'],
  [/^support\s+/i, ' desteği eklendi']
]

const TYPE_SUFFIXES = {
  fix: ' düzeltildi',
  perf: ' iyileştirildi',
  refactor: ' iyileştirildi'
}

export function humanizeCommitSubject(subject) {
  const { type, rest } = splitConventionalCommit(subject)
  const cleaned = rest
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return null

  for (const [verb, suffix] of LEADING_VERBS) {
    if (verb.test(cleaned)) {
      const object = replaceCommitTerms(cleaned.replace(verb, '').trim())
      if (object) return capitalizeSentence(object) + suffix
    }
  }

  return capitalizeSentence(replaceCommitTerms(cleaned)) + (TYPE_SUFFIXES[type] ?? '')
}

export function ensureLegalNote(notes) {
  if (/legal note/i.test(notes) || /yasal not/i.test(notes)) {
    return notes
  }

  return `${normalizeReleaseText(notes)}\n\n${LEGAL_NOTE}\n`
}

export function buildDefaultNotes(version, subjects) {
  const bulletLines = subjects
    .filter((subject) => !subject.toLowerCase().startsWith('release:'))
    .map((subject) => humanizeCommitSubject(subject))
    .filter(Boolean)
    .map((subject) => `- ${subject}`)

  const sections = [
    `Abi Player ${version} sürümü hazır.`,
    '',
    'Öne Çıkanlar',
    ...(bulletLines.length > 0
      ? bulletLines
      : ['- Bu Windows sürümü için kurulum paketi ve güncelleme meta verileri yenilendi']),
    '',
    'Notlar',
    '- Bu release, Windows kurulum dosyasını, blockmap dosyasını ve latest.yml güncelleme bilgisini içerir.'
  ]

  return ensureLegalNote(sections.join('\n'))
}

// ---------------------------------------------------------------------------
// Kaynak arşivleri (THIRD-PARTY-NOTICES.md, "Kaynak kodu")

/**
 * Her sürüme yüklenen kaynak arşivleri, sabitlerdeki `sources` kaydından:
 * mpv, kurulumdaki FFmpeg, mpv'ye gömülü FFmpeg ve iki derleme projesinin
 * betikleri. Adlar 0.5.0-beta'da elle yüklenenlerle aynı kurala uyar:
 *   source-mpv-<mpv commit, 10 hane>.tar.gz
 *   source-ffmpeg-<FFmpeg sürümü, ör. n9.0.2-39-g7adfbe40dc>.tar.gz
 *   source-ffmpeg-in-mpv-<FFmpeg commit, 9 hane>.tar.gz
 *   source-mpv-build-scripts-<mpv sabitinin sürüm etiketi>.tar.gz
 *   source-ffmpeg-build-scripts-<FFmpeg sabitinin yapı günü>.tar.gz
 * Sabitlerin kendi içinde tutarsızlığı (dosya adındaki kısa commit ile kayıtlı
 * commit farklı) hata sayılır.
 */
export function sourceArchivesFromPins(mpvPin, ffmpegPin) {
  const mpv = mpvPin?.sources
  const ffmpeg = ffmpegPin?.sources
  if (!mpv?.mpv || !mpv.ffmpeg || !mpv.buildScripts || !ffmpeg?.ffmpeg || !ffmpeg.buildScripts) {
    throw new Error('mpv-pin.json veya ffmpeg-pin.json içinde sources kaydı eksik.')
  }

  const mpvShort = /-git-([0-9a-f]{7,40})\.7z$/.exec(String(mpvPin.assetName))?.[1]
  if (!mpvShort || !mpv.mpv.commit.startsWith(mpvShort)) {
    throw new Error(`mpv-pin.json: ${mpvPin.assetName} ile sources.mpv.commit (${mpv.mpv.commit}) uyuşmuyor.`)
  }
  const { version, shortHash } = ffmpegVersionOf(ffmpegPin.assetName)
  if (!ffmpeg.ffmpeg.commit.startsWith(shortHash)) {
    throw new Error(`ffmpeg-pin.json: ${ffmpegPin.assetName} ile sources.ffmpeg.commit (${ffmpeg.ffmpeg.commit}) uyuşmuyor.`)
  }
  const buildDay = /^autobuild-(\d{4}-\d{2}-\d{2})-/.exec(String(ffmpegPin.releaseTag))?.[1]
  if (!buildDay) throw new Error(`ffmpeg-pin.json: ${ffmpegPin.releaseTag} bir autobuild etiketi değil.`)
  if (!/^[\w.-]+$/.test(String(mpvPin.releaseTag))) {
    throw new Error(`mpv-pin.json: ${mpvPin.releaseTag} dosya adına uygun değil.`)
  }

  const entry = (name, source) => ({ name, repository: source.repository, commit: source.commit })
  return [
    entry(`source-mpv-${mpv.mpv.commit.slice(0, 10)}.tar.gz`, mpv.mpv),
    entry(`source-ffmpeg-${version}.tar.gz`, ffmpeg.ffmpeg),
    entry(`source-ffmpeg-in-mpv-${mpv.ffmpeg.commit.slice(0, 9)}.tar.gz`, mpv.ffmpeg),
    entry(`source-mpv-build-scripts-${mpvPin.releaseTag}.tar.gz`, mpv.buildScripts),
    entry(`source-ffmpeg-build-scripts-${buildDay}.tar.gz`, ffmpeg.buildScripts)
  ]
}

/** GitHub'ın bir commit için verdiği kaynak arşivinin adresi (`git archive` çıktısı). */
export function sourceTarballUrl(archive) {
  return `https://api.github.com/repos/${archive.repository}/tarball/${archive.commit}`
}

/**
 * GitHub kaynak arşivinin hangi commit'ten yapıldığı: `git archive` ilk girdi
 * olarak bir pax genel başlığı yazar ve commit'i `comment` kaydına koyar.
 * Arşiv gzip değilse ya da böyle bir başlık yoksa null.
 */
export function tarballCommit(gzipped) {
  let tar
  try {
    tar = gunzipSync(gzipped)
  } catch {
    return null
  }
  if (tar.length < 512) return null
  const typeflag = String.fromCharCode(tar[156])
  const name = tar.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '')
  if (typeflag !== 'g' || name !== 'pax_global_header') return null
  const size = Number.parseInt(tar.subarray(124, 136).toString('utf8').replace(/\0/g, '').trim(), 8)
  if (!Number.isInteger(size) || size <= 0 || 512 + size > tar.length) return null
  const records = tar.subarray(512, 512 + size).toString('utf8')
  const match = /(?:^|\n)\d+ comment=([0-9a-f]{40})\n/.exec(records)
  return match ? match[1] : null
}

/** İndirilen (veya önceki çalıştırmadan kalan) arşiv kullanılabilir mi; değilse neden. */
export function sourceArchiveProblem(content, archive) {
  const commit = tarballCommit(content)
  if (!commit) return `${archive.name} is not a GitHub source archive (no commit in its pax header)`
  if (commit !== archive.commit) return `${archive.name} was made from ${commit}, expected ${archive.commit}`
  return null
}

// ---------------------------------------------------------------------------
// Yükleme sırası ve sunucu tarafı doğrulama

/**
 * Yüklenecek dosyaların `publishRelease` biçimi: boyut ve sha256 içerikten
 * hesaplanır. latest.yml içeriğini taşır ki sunucudaki kopyayla bayt bayt
 * karşılaştırılabilsin; büyük kurulum dosyası taşımaz.
 */
export function describeReleaseFiles(entries) {
  return entries.map(({ name, path, content }) => ({
    name,
    path,
    size: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
    ...(name === UPDATE_MANIFEST ? { content } : {})
  }))
}

/** latest.yml her zaman en sona: istemcilere yeni sürümü o duyurur. */
export function orderForUpload(fileNames) {
  return [
    ...fileNames.filter((name) => name !== UPDATE_MANIFEST),
    ...fileNames.filter((name) => name === UPDATE_MANIFEST)
  ]
}

/**
 * GitHub'ın varlık için hesapladığı sha256 (`digest: "sha256:<hex>"`), küçük
 * harfle; alan yoksa veya başka bir algoritmaysa null.
 */
export function assetSha256(asset) {
  const match = typeof asset?.digest === 'string' ? asset.digest.match(/^sha256:([0-9a-f]{64})$/i) : null
  return match ? match[1].toLowerCase() : null
}

/**
 * Sunucudaki varlık listesi yerel dosyalarla birebir mi? Eksik, yarım, boyutu
 * veya sha256'sı tutmayan ya da beklenmeyen fazladan varlık bir sorun sayılır.
 * GitHub sha256 bildirmezse yalnızca boyut denetlenir (bu çalıştırmada yüklenen
 * varlık; atlanan bir varlık zaten sha256 eşleşmesiyle atlanır).
 */
export function verifyRemoteAssets(remoteAssets, expectedFiles) {
  const problems = []
  const byName = new Map(remoteAssets.map((asset) => [asset.name, asset]))

  for (const file of expectedFiles) {
    const asset = byName.get(file.name)
    const remoteSha256 = assetSha256(asset)
    if (!asset) {
      problems.push(`${file.name} is missing from the release`)
    } else if (asset.state !== 'uploaded') {
      problems.push(`${file.name} is in state "${String(asset.state)}", not "uploaded"`)
    } else if (asset.size !== file.size) {
      problems.push(`${file.name} is ${asset.size} bytes on GitHub, ${file.size} bytes locally`)
    } else if (remoteSha256 && file.sha256 && remoteSha256 !== file.sha256.toLowerCase()) {
      problems.push(`${file.name} on GitHub differs from the local file (sha256 ${remoteSha256}, expected ${file.sha256})`)
    }
  }

  const expectedNames = new Set(expectedFiles.map((file) => file.name))
  for (const asset of remoteAssets) {
    if (!expectedNames.has(asset.name)) {
      problems.push(`Unexpected asset on the release: ${asset.name}`)
    }
  }

  return problems
}

/**
 * Var olan varlık yeniden yüklenmeden kalabilir mi? Yalnızca içeriği yerel
 * dosyayla aynıysa: tamamlanmış, aynı boyutta ve GitHub'ın sha256'sı yerel
 * dosyanınkine eşit. Aynı boyutta ama başka baytlardan oluşan bir varlık (yeniden
 * derlenmiş kurulum dosyası) ya da sha256'sı bilinmeyen bir varlık değiştirilir.
 */
export function isAssetIntact(asset, file) {
  const remoteSha256 = assetSha256(asset)
  return (
    asset?.state === 'uploaded' &&
    asset.size === file.size &&
    typeof file.sha256 === 'string' &&
    remoteSha256 !== null &&
    remoteSha256 === file.sha256.toLowerCase()
  )
}

// ---------------------------------------------------------------------------
// GitHub akışı

/**
 * Taslak oluştur (veya var olan taslağı güncelle) → dosyaları yükle → sunucudaki
 * durumu doğrula → ancak o zaman yayınla. Herhangi bir adımda hata atılırsa sürüm
 * taslak kalır; hiçbir şey herkese açık olmaz. Yeniden çalıştırma aynı taslağı
 * kaldığı yerden sürdürür.
 *
 * `api` beklenen yöntemler:
 *   findReleaseByTag(tag)            → sürüm | null (taslaklar dahil)
 *   createRelease(payload)           → sürüm
 *   updateRelease(id, payload)       → sürüm
 *   listAssets(releaseId)            → varlık[]
 *   deleteAsset(assetId)             → void
 *   uploadFiles(release, files)      → void (dosyalar verilen sırayla)
 *   downloadAsset(asset)             → Buffer
 *
 * `files`: [{ name, path, size, sha256, content? }]; `sha256` dosyanın onaltılık
 * özetidir ve var olan varlığın atlanıp atlanmayacağını o belirler. latest.yml
 * için `content` verilirse sunucudaki kopya bayt bayt karşılaştırılır.
 */
export async function publishRelease({
  api,
  tag,
  targetCommitish,
  releaseName,
  notes,
  prerelease,
  keepDraft,
  files,
  log = () => {}
}) {
  const draftPayload = {
    tag_name: tag,
    target_commitish: targetCommitish,
    name: releaseName,
    body: notes,
    draft: true,
    prerelease
  }

  let release = await api.findReleaseByTag(tag)
  if (release && !release.draft) {
    throw new Error(
      `${tag} is already published (${release.html_url}). Nothing was changed; bump the version for a new release.`
    )
  }

  if (release) {
    log(`Updating existing draft release ${release.id}...`)
    release = await api.updateRelease(release.id, draftPayload)
  } else {
    log('Creating draft release...')
    release = await api.createRelease(draftPayload)
  }

  if (!release?.draft) {
    throw new Error('GitHub did not return a draft release; refusing to continue.')
  }

  // İçeriği yerel dosyadan farklı, bozuk ya da yarım kalmış varlıklar silinip
  // yeniden yüklenir; yalnızca baytları aynı olanlar atlanır.
  const existing = await api.listAssets(release.id)
  const pending = []
  for (const name of orderForUpload(files.map((file) => file.name))) {
    const file = files.find((candidate) => candidate.name === name)
    const asset = existing.find((candidate) => candidate.name === name)
    if (isAssetIntact(asset, file)) {
      log(`Skipped ${name} (already uploaded)`)
      continue
    }
    if (asset) await api.deleteAsset(asset.id)
    pending.push(file)
  }

  const payload = pending.filter((file) => file.name !== UPDATE_MANIFEST)
  const manifest = pending.filter((file) => file.name === UPDATE_MANIFEST)
  if (payload.length > 0) await api.uploadFiles(release, payload)
  if (manifest.length > 0) await api.uploadFiles(release, manifest)

  log('Verifying uploaded assets...')
  const remoteAssets = await api.listAssets(release.id)
  const problems = verifyRemoteAssets(remoteAssets, files)

  const localManifest = files.find((file) => file.name === UPDATE_MANIFEST && file.content)
  if (localManifest && problems.length === 0) {
    const remoteManifest = remoteAssets.find((asset) => asset.name === UPDATE_MANIFEST)
    const remoteContent = await api.downloadAsset(remoteManifest)
    if (!Buffer.from(remoteContent).equals(Buffer.from(localManifest.content))) {
      problems.push('latest.yml on GitHub differs from dist/latest.yml')
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Release verification failed; the release stays a draft:\n- ${problems.join('\n- ')}`
    )
  }

  if (keepDraft) {
    log('Leaving the release as a draft (--draft).')
    return release
  }

  log('Publishing release...')
  const published = await api.updateRelease(release.id, { draft: false })
  if (published?.draft !== false) {
    throw new Error('GitHub did not confirm the release as published.')
  }
  return published
}
