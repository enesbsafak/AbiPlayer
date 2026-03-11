#!/usr/bin/env node

import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { basename, join, resolve } from 'path'

const LEGAL_NOTE = [
  'Yasal Not',
  'Abi Player yalnızca bir oynatıcıdır; içerik sağlamaz, satmaz, dağıtmaz veya barındırmaz.',
  'Kullanılan kaynakların yasal uygunluğundan kullanıcı sorumludur.'
].join('\n')

const COMMIT_TRANSLATIONS = [
  [/player/gi, 'oynatıcı'],
  [/catalog/gi, 'katalog'],
  [/loading/gi, 'yükleme'],
  [/\bux\b/gi, 'kullanıcı deneyimi'],
  [/\bui\b/gi, 'arayüz'],
  [/image(s)?/gi, (_, plural) => (plural ? 'görseller' : 'görsel')],
  [/category/gi, 'kategori'],
  [/categories/gi, 'kategoriler'],
  [/\bmpv\b/gi, 'MPV'],
  [/spinner/gi, 'yükleniyor göstergesi'],
  [/release notes?/gi, 'release notları'],
  [/update(s)?/gi, (_, plural) => (plural ? 'güncellemeler' : 'güncelleme')]
]

function parseArgs(argv) {
  const options = {
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
    if (arg === '--draft') options.draft = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--no-push') options.push = false
    else if (arg === '--skip-build') options.skipBuild = true
    else if (arg === '--stable') options.stable = true
    else if (arg === '--allow-dirty-tracked') options.allowDirtyTracked = true
    else if (arg === '--notes-file') options.notesFile = argv[++index] ?? null
    else if (arg.startsWith('--notes-file=')) options.notesFile = arg.slice('--notes-file='.length)
    else if (arg === '--repo') options.repo = argv[++index] ?? null
    else if (arg.startsWith('--repo=')) options.repo = arg.slice('--repo='.length)
    else if (arg === '--name') options.name = argv[++index] ?? null
    else if (arg.startsWith('--name=')) options.name = arg.slice('--name='.length)
    else if (arg === '--target') options.target = argv[++index] ?? null
    else if (arg.startsWith('--target=')) options.target = arg.slice('--target='.length)
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage: npm run release:win -- [options]

Options:
  --notes-file <path>       Read release notes from a UTF-8 markdown file
  --repo <owner/repo>       Override GitHub repository
  --name <release name>     Override release title
  --target <branch>         Override target branch/commitish
  --skip-build              Reuse existing dist artifacts
  --no-push                 Skip git push for branch and tag
  --draft                   Create or update a draft release
  --stable                  Force prerelease=false
  --dry-run                 Validate everything except push/release upload
  --allow-dirty-tracked     Allow tracked git changes
`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    input: options.input,
    stdio: options.stdio ?? 'pipe'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim()
    const stdout = result.stdout?.trim()
    throw new Error(stderr || stdout || `${command} exited with code ${result.status}`)
  }

  return result.stdout?.trim() ?? ''
}

function runLogged(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`)
  }
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function ensureNoTrackedChanges() {
  const trackedChanges = run('git', ['status', '--short', '--untracked-files=no'])
  if (trackedChanges) {
    throw new Error(
      'Tracked git changes detected. Commit them first or rerun with --allow-dirty-tracked.'
    )
  }
}

function getCurrentBranch() {
  const branch = run('git', ['branch', '--show-current'])
  if (!branch) {
    throw new Error('Detached HEAD is not supported for release publishing.')
  }
  return branch
}

function ensureTagAtHead(tag) {
  const headSha = run('git', ['rev-parse', 'HEAD'])
  const tagShaResult = spawnSync('git', ['rev-list', '-n', '1', tag], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe'
  })

  if (tagShaResult.status === 0) {
    const tagSha = tagShaResult.stdout.trim()
    if (tagSha !== headSha) {
      throw new Error(`${tag} already exists on a different commit.`)
    }
    return
  }

  runLogged('git', ['tag', '-a', tag, '-m', `release: ${tag}`])
}

function parseGitHubRepo(remoteUrl) {
  const match = remoteUrl.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+?)(?:\.git)?$/i)
  if (!match?.groups) {
    throw new Error(`Could not parse GitHub repository from remote URL: ${remoteUrl}`)
  }

  return `${match.groups.owner}/${match.groups.repo}`
}

function resolveGitHubToken() {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (envToken) return envToken

  const filled = run('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n'
  })

  const passwordLine = filled
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith('password='))

  if (!passwordLine) {
    throw new Error('GitHub token not found. Set GITHUB_TOKEN or configure git credentials.')
  }

  return passwordLine.slice('password='.length)
}

function inferPrerelease(version, forceStable) {
  if (forceStable) return false
  return /-(alpha|beta|rc)(?:[.-]|$)/i.test(version)
}

async function verifyArtifacts(packageName, version) {
  const installerName = `${packageName}-${version}-setup.exe`
  const installerPath = join(process.cwd(), 'dist', installerName)
  const blockmapPath = `${installerPath}.blockmap`
  const latestYmlPath = join(process.cwd(), 'dist', 'latest.yml')

  for (const filePath of [installerPath, blockmapPath, latestYmlPath]) {
    if (!existsSync(filePath)) {
      throw new Error(`Expected artifact not found: ${filePath}`)
    }
    await stat(filePath)
  }

  const latestYml = await readFile(latestYmlPath, 'utf8')
  if (!latestYml.includes(`version: ${version}`)) {
    throw new Error(`dist/latest.yml does not reference version ${version}`)
  }
  if (!latestYml.includes(`path: ${installerName}`)) {
    throw new Error(`dist/latest.yml does not reference ${installerName}`)
  }

  const sizeMatch = latestYml.match(/^\s*size:\s*(\d+)/m)
  if (sizeMatch) {
    const installerStat = await stat(installerPath)
    const expectedSize = Number(sizeMatch[1])
    if (installerStat.size !== expectedSize) {
      throw new Error(
        `dist/latest.yml size (${expectedSize}) does not match installer size (${installerStat.size})`
      )
    }
  }

  return {
    installerName,
    installerPath,
    blockmapPath,
    latestYmlPath
  }
}

function findPreviousTag(currentTag) {
  const tags = run('git', ['tag', '--list', 'v*', '--sort=-version:refname'])
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean)

  return tags.find((tag) => tag !== currentTag) ?? null
}

function collectRecentCommitSubjects(currentTag) {
  const previousTag = findPreviousTag(currentTag)
  const range = previousTag ? `${previousTag}..HEAD` : 'HEAD'
  const output = run('git', ['log', '--pretty=format:%s', range])

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().startsWith('release:'))
}

function normalizeReleaseText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').normalize('NFC').trim()
}

function splitConventionalCommit(subject) {
  const match = subject.match(/^(?<type>[a-z]+)(?:\([^)]+\))?!?:\s*(?<rest>.+)$/i)
  if (!match?.groups) {
    return { type: 'other', rest: subject.trim() }
  }

  return {
    type: match.groups.type.toLowerCase(),
    rest: match.groups.rest.trim()
  }
}

function replaceCommitTerms(text) {
  return COMMIT_TRANSLATIONS.reduce((current, [pattern, replacement]) => {
    return current.replace(pattern, replacement)
  }, text)
}

function capitalizeSentence(text) {
  if (!text) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function humanizeCommitSubject(subject) {
  const { type, rest } = splitConventionalCommit(subject)
  const translated = replaceCommitTerms(
    rest
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )

  if (!translated) return null

  if (/^improve\s+/i.test(rest)) {
    return capitalizeSentence(translated.replace(/^improve\s+/i, '').trim()) + ' iyileştirildi'
  }

  if (/^add\s+/i.test(rest)) {
    return capitalizeSentence(translated.replace(/^add\s+/i, '').trim()) + ' eklendi'
  }

  if (/^fix\s+/i.test(rest)) {
    return capitalizeSentence(translated.replace(/^fix\s+/i, '').trim()) + ' düzeltildi'
  }

  if (/^update\s+/i.test(rest)) {
    return capitalizeSentence(translated.replace(/^update\s+/i, '').trim()) + ' güncellendi'
  }

  if (/^support\s+/i.test(rest)) {
    return capitalizeSentence(translated.replace(/^support\s+/i, '').trim()) + ' desteği eklendi'
  }

  if (type === 'feat') {
    return capitalizeSentence(translated)
  }

  if (type === 'fix') {
    return capitalizeSentence(translated) + ' düzeltildi'
  }

  if (type === 'perf' || type === 'refactor') {
    return capitalizeSentence(translated) + ' iyileştirildi'
  }

  return capitalizeSentence(translated)
}

function ensureLegalNote(notes) {
  if (/legal note/i.test(notes) || /yasal not/i.test(notes)) {
    return notes
  }

  return `${normalizeReleaseText(notes)}\n\n${LEGAL_NOTE}\n`
}

function buildDefaultNotes(version, currentTag) {
  const subjects = collectRecentCommitSubjects(currentTag)
  const bulletLines =
    subjects.length > 0
      ? subjects
          .map((subject) => humanizeCommitSubject(subject))
          .filter(Boolean)
          .map((subject) => `- ${subject}`)
      : ['- Bu Windows sürümü için kurulum paketi ve güncelleme meta verileri yenilendi']

  const sections = [
    `Abi Player ${version} sürümü hazır.`,
    '',
    'Öne Çıkanlar',
    ...bulletLines,
    '',
    'Notlar',
    '- Bu release, Windows kurulum dosyasını, blockmap dosyasını ve latest.yml güncelleme bilgisini içerir.'
  ]

  return ensureLegalNote(sections.join('\n'))
}

async function loadReleaseNotes(version, tag, notesFile) {
  if (!notesFile) {
    return buildDefaultNotes(version, tag)
  }

  const notesPath = resolve(process.cwd(), notesFile)
  const content = await readFile(notesPath, 'utf8')
  const normalizedContent = normalizeReleaseText(content)
  if (!normalizedContent) {
    throw new Error(`Release notes file is empty: ${notesPath}`)
  }

  return ensureLegalNote(normalizedContent)
}

async function githubRequest(url, token, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'AbiPlayerReleaseScript',
    ...(options.headers ?? {})
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body
  })

  if (!response.ok) {
    const errorText = (await response.text()).trim()
    throw new Error(`GitHub API ${response.status}: ${errorText || response.statusText}`)
  }

  if (response.status === 204) return null
  return response.json()
}

async function findReleaseByTag(apiBase, tag, token) {
  const response = await fetch(`${apiBase}/releases/tags/${tag}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AbiPlayerReleaseScript'
    }
  })

  if (response.status === 404) return null
  if (!response.ok) {
    const errorText = (await response.text()).trim()
    throw new Error(`GitHub API ${response.status}: ${errorText || response.statusText}`)
  }

  return response.json()
}

async function upsertRelease({
  apiBase,
  branch,
  notes,
  prerelease,
  releaseName,
  tag,
  token,
  draft
}) {
  const payload = JSON.stringify({
    tag_name: tag,
    target_commitish: branch,
    name: releaseName,
    body: notes,
    draft,
    prerelease
  })

  const existing = await findReleaseByTag(apiBase, tag, token)
  if (existing) {
    const updated = await githubRequest(`${apiBase}/releases/${existing.id}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: payload
    })
    return updated
  }

  return githubRequest(`${apiBase}/releases`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: payload
  })
}

async function uploadAsset(uploadUrlTemplate, token, filePath) {
  const uploadUrl = uploadUrlTemplate.split('{')[0]
  const fileName = basename(filePath)
  const content = await readFile(filePath)

  await githubRequest(`${uploadUrl}?name=${encodeURIComponent(fileName)}`, token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(content.byteLength)
    },
    body: content
  })
}

async function replaceReleaseAssets(apiBase, release, token, filePaths) {
  const existingAssets = Array.isArray(release.assets) ? release.assets : []

  for (const filePath of filePaths) {
    const fileName = basename(filePath)
    for (const asset of existingAssets.filter((item) => item.name === fileName)) {
      await githubRequest(`${apiBase}/releases/assets/${asset.id}`, token, {
        method: 'DELETE'
      })
    }

    await uploadAsset(release.upload_url, token, filePath)
    console.log(`Uploaded ${fileName}`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'))
  const version = packageJson.version
  const packageName = packageJson.name
  const tag = `v${version}`
  const branch = options.target || getCurrentBranch()
  const releaseName =
    options.name ||
    `Abi Player ${tag} (${inferPrerelease(version, options.stable) ? 'Public Beta' : 'Public Release'})`

  if (!options.allowDirtyTracked) {
    ensureNoTrackedChanges()
  }

  if (!options.skipBuild) {
    console.log('Building Windows release artifacts...')
    runLogged(npmCommand(), ['run', 'build:win'])
  }

  const artifacts = await verifyArtifacts(packageName, version)
  const notes = await loadReleaseNotes(version, tag, options.notesFile)

  if (options.dryRun) {
    console.log('Dry run complete.')
    console.log(`Version: ${version}`)
    console.log(`Tag: ${tag}`)
    console.log(`Target: ${branch}`)
    console.log(`Artifacts: ${artifacts.installerName}, ${basename(artifacts.blockmapPath)}, latest.yml`)
    return
  }

  if (options.push) {
    ensureTagAtHead(tag)
    console.log(`Pushing branch ${branch}...`)
    runLogged('git', ['push', 'origin', branch])
    console.log(`Pushing tag ${tag}...`)
    runLogged('git', ['push', 'origin', tag])
  }

  const repo = options.repo || parseGitHubRepo(run('git', ['config', '--get', 'remote.origin.url']))
  const token = resolveGitHubToken()
  const apiBase = `https://api.github.com/repos/${repo}`
  const prerelease = inferPrerelease(version, options.stable)

  console.log(`Publishing GitHub release to ${repo}...`)
  const release = await upsertRelease({
    apiBase,
    branch,
    notes,
    prerelease,
    releaseName,
    tag,
    token,
    draft: options.draft
  })

  await replaceReleaseAssets(apiBase, release, token, [
    artifacts.installerPath,
    artifacts.blockmapPath,
    artifacts.latestYmlPath
  ])

  console.log(`Release ready: ${release.html_url}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[release-win] ${message}`)
  process.exit(1)
})
