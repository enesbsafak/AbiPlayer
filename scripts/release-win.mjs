#!/usr/bin/env node

// Windows sürümünü derler ve GitHub'a yayınlar. Sıra (F0-04):
//   sürüm denetimi → birim testleri → derleme → dosya doğrulaması → belirteç
//   → push → taslak sürüm → yükleme → sunucuda doğrulama → yayın
// Push'tan sonraki herhangi bir hatada sürüm taslak kalır; yeniden çalıştırmak
// aynı taslağı kaldığı yerden sürdürür. Saf mantık release-lib.mjs'te.

import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { basename, join, resolve } from 'path'
import {
  HELP_TEXT,
  UPDATE_MANIFEST,
  buildDefaultNotes,
  checkVersionSync,
  describeReleaseFiles,
  ensureLegalNote,
  inferPrerelease,
  isAssetIntact,
  normalizeReleaseText,
  parseArgs,
  parseGitHubRepo,
  publishRelease,
  remoteTagProblem,
  resolveRemoteTagCommit,
  verifyUpdateManifest
} from './release-lib.mjs'

const API_TIMEOUT_MS = 60_000
const UPLOAD_TIMEOUT_MS = 30 * 60_000
const UPLOAD_MAX_ATTEMPTS = 3
const UPLOAD_RETRY_DELAY_MS = 4000

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
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
  // .cmd dosyaları Windows'ta yalnızca kabukla çalışır. Kabuğa argüman dizisi
  // vermek kullanımdan kalktı (DEP0190); buradaki argümanlar sabit olduğu için
  // tek komut satırı olarak birleştirilir.
  const options = { cwd: process.cwd(), encoding: 'utf8', stdio: 'inherit' }
  const needsShell = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')
  const result = needsShell
    ? spawnSync([command, ...args].join(' '), { ...options, shell: true })
    : spawnSync(command, args, options)

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`)
  }
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// git

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

function localTagCommit(tag) {
  const result = spawnSync('git', ['rev-list', '-n', '1', `refs/tags/${tag}`], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe'
  })
  return result.status === 0 ? result.stdout.trim() : null
}

function ensureLocalTagNotElsewhere(tag, headSha) {
  const tagSha = localTagCommit(tag)
  if (tagSha && tagSha !== headSha) {
    throw new Error(`${tag} already exists locally on a different commit (${tagSha.slice(0, 12)}).`)
  }
}

function createLocalTagAtHead(tag, headSha) {
  ensureLocalTagNotElsewhere(tag, headSha)
  if (!localTagCommit(tag)) {
    runLogged('git', ['tag', '-a', tag, '-m', `release: ${tag}`])
  }
}

function readRemoteTag(tag) {
  return run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
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
  return run('git', ['log', '--pretty=format:%s', range])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function resolveGitHubToken() {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (envToken) return envToken

  let filled
  try {
    filled = run('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
  } catch {
    filled = ''
  }

  const passwordLine = filled
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith('password='))

  if (!passwordLine) {
    throw new Error('GitHub token not found. Set GITHUB_TOKEN or configure git credentials.')
  }

  return passwordLine.slice('password='.length)
}

// ---------------------------------------------------------------------------
// Yerel dosyalar

async function verifyArtifacts(packageName, version) {
  const distDir = join(process.cwd(), 'dist')
  const installerName = `${packageName}-${version}-setup.exe`
  const installerPath = join(distDir, installerName)
  const blockmapPath = `${installerPath}.blockmap`
  const latestYmlPath = join(distDir, UPDATE_MANIFEST)

  for (const filePath of [installerPath, blockmapPath, latestYmlPath]) {
    if (!existsSync(filePath)) {
      throw new Error(`Expected artifact not found: ${filePath}`)
    }
  }

  const installer = await readFile(installerPath)
  const installerSha512 = createHash('sha512').update(installer).digest('base64')
  const latestYml = await readFile(latestYmlPath)

  const problems = verifyUpdateManifest(latestYml.toString('utf8'), {
    version,
    installerName,
    installerSize: installer.length,
    installerSha512
  })
  if (problems.length > 0) {
    throw new Error(`dist/${UPDATE_MANIFEST} is not valid:\n- ${problems.join('\n- ')}`)
  }

  const files = describeReleaseFiles([
    { name: basename(installerPath), path: installerPath, content: installer },
    { name: basename(blockmapPath), path: blockmapPath, content: await readFile(blockmapPath) },
    { name: UPDATE_MANIFEST, path: latestYmlPath, content: latestYml }
  ])

  return { installerName, files }
}

async function loadReleaseNotes(version, tag, notesFile) {
  if (!notesFile) {
    return buildDefaultNotes(version, collectRecentCommitSubjects(tag))
  }

  const notesPath = resolve(process.cwd(), notesFile)
  const content = await readFile(notesPath, 'utf8')
  const normalizedContent = normalizeReleaseText(content)
  if (!normalizedContent) {
    throw new Error(`Release notes file is empty: ${notesPath}`)
  }

  return ensureLegalNote(normalizedContent)
}

// ---------------------------------------------------------------------------
// GitHub API

function createGitHubApi({ repo, token }) {
  const apiBase = `https://api.github.com/repos/${repo}`
  const baseHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'AbiPlayerReleaseScript'
  }

  async function send(url, options = {}) {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { ...baseHeaders, ...(options.headers ?? {}) },
      body: options.body,
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? API_TIMEOUT_MS)
    })

    if (options.allow404 && response.status === 404) return null
    if (!response.ok) {
      const errorText = (await response.text()).trim()
      throw new Error(`GitHub API ${response.status}: ${errorText || response.statusText}`)
    }
    return response
  }

  async function json(url, options = {}) {
    const response = await send(url, options)
    if (!response || response.status === 204) return null
    return response.json()
  }

  function jsonBody(payload) {
    return {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    }
  }

  async function uploadAsset(release, file) {
    const uploadUrl = release.upload_url.split('{')[0]
    const content = await readFile(file.path)
    // Content-Length gövdeden türetilir; elle vermek yasak başlıktır.
    await json(`${uploadUrl}?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: content,
      timeoutMs: UPLOAD_TIMEOUT_MS
    })
  }

  const api = {
    async getRepository() {
      return json(apiBase)
    },

    // /releases/tags/{tag} taslakları döndürmez; bulunamazsa liste taranır.
    async findReleaseByTag(tag) {
      const published = await json(`${apiBase}/releases/tags/${encodeURIComponent(tag)}`, {
        allow404: true
      })
      if (published) return published

      for (let page = 1; page <= 10; page += 1) {
        const releases = await json(`${apiBase}/releases?per_page=100&page=${page}`)
        if (!Array.isArray(releases) || releases.length === 0) return null
        const match = releases.find((release) => release.tag_name === tag)
        if (match) return match
        if (releases.length < 100) return null
      }
      return null
    },

    async createRelease(payload) {
      return json(`${apiBase}/releases`, { method: 'POST', ...jsonBody(payload) })
    },

    async updateRelease(id, payload) {
      return json(`${apiBase}/releases/${id}`, { method: 'PATCH', ...jsonBody(payload) })
    },

    async listAssets(releaseId) {
      const assets = await json(`${apiBase}/releases/${releaseId}/assets?per_page=100`)
      return Array.isArray(assets) ? assets : []
    },

    async deleteAsset(assetId) {
      await json(`${apiBase}/releases/assets/${assetId}`, { method: 'DELETE' })
    },

    async downloadAsset(asset) {
      const response = await send(`${apiBase}/releases/assets/${asset.id}`, {
        headers: { Accept: 'application/octet-stream' }
      })
      return Buffer.from(await response.arrayBuffer())
    },

    /**
     * Node'un fetch'i gövdeyi bellekte tutar ve ~250MB kurulum dosyasında
     * güvenilmezdir (v0.4.8 ve v0.4.9). `gh` akış halinde yükler; kuruluysa o
     * kullanılır, olmazsa API yükleyicisi yeniden denemeyle devreye girer.
     */
    async uploadFiles(release, files) {
      if (ghCliAvailable()) {
        try {
          runLogged('gh', [
            'release',
            'upload',
            release.tag_name,
            ...files.map((file) => file.path),
            '--clobber',
            '--repo',
            repo
          ])
          for (const file of files) console.log(`Uploaded ${file.name}`)
          return
        } catch (error) {
          console.warn(`gh release upload failed (${errorMessage(error)}); falling back to the API uploader...`)
        }
      }

      for (const file of files) {
        await uploadWithRetry(release, file)
        console.log(`Uploaded ${file.name}`)
      }
    }
  }

  // GitHub gövdeyi sakladıktan sonra bağlantıyı düşürebilir; her denemeden önce
  // sunucu durumu okunur ve tamamlanmış varlık başarılı sayılır.
  async function uploadWithRetry(release, file) {
    for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      const existing = (await api.listAssets(release.id)).find((asset) => asset.name === file.name)
      if (existing) {
        if (isAssetIntact(existing, file)) return
        await api.deleteAsset(existing.id)
      }

      try {
        await uploadAsset(release, file)
        return
      } catch (error) {
        if (attempt === UPLOAD_MAX_ATTEMPTS) {
          throw new Error(`Failed to upload ${file.name} after ${attempt} attempts: ${errorMessage(error)}`, {
            cause: error
          })
        }
        console.warn(
          `Upload of ${file.name} failed (${errorMessage(error)}); retrying ${attempt + 1}/${UPLOAD_MAX_ATTEMPTS}...`
        )
        await new Promise((resolveDelay) => setTimeout(resolveDelay, UPLOAD_RETRY_DELAY_MS))
      }
    }
  }

  return api
}

function ghCliAvailable() {
  const result = spawnSync('gh', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP_TEXT)
    return
  }

  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'))
  const packageLock = JSON.parse(await readFile(join(process.cwd(), 'package-lock.json'), 'utf8'))
  const versionProblems = checkVersionSync(packageJson, packageLock)
  if (versionProblems.length > 0) {
    throw new Error(
      `Version check failed:\n- ${versionProblems.join('\n- ')}\n` +
        'Bump with `npm version <version> --no-git-tag-version` so both files change together.'
    )
  }

  const version = packageJson.version
  const packageName = packageJson.name
  const tag = `v${version}`
  const prerelease = inferPrerelease(version, options.stable)
  const releaseName =
    options.name || `Abi Player ${tag} (${prerelease ? 'Public Beta' : 'Public Release'})`

  if (!options.allowDirtyTracked) {
    ensureNoTrackedChanges()
  }

  const branch = options.target || getCurrentBranch()
  const headSha = run('git', ['rev-parse', 'HEAD'])
  const repo = options.repo || parseGitHubRepo(run('git', ['config', '--get', 'remote.origin.url']))

  // Etiket denetimleri derlemeden önce: yanlış durumda dakikalarca derlemeyelim.
  const remoteTag = readRemoteTag(tag)
  if (options.push) {
    ensureLocalTagNotElsewhere(tag, headSha)
    const remoteSha = resolveRemoteTagCommit(remoteTag, tag)
    if (remoteSha && remoteSha !== headSha) {
      throw new Error(`${tag} already exists on origin at ${remoteSha.slice(0, 12)}, not at HEAD.`)
    }
  } else {
    const problem = remoteTagProblem(remoteTag, tag, headSha)
    if (problem) throw new Error(`--no-push: ${problem}`)
  }

  console.log('Running unit tests...')
  runLogged(npmCommand(), ['test'])

  if (!options.skipBuild) {
    console.log('Building Windows release artifacts...')
    runLogged(npmCommand(), ['run', 'build:win'])
  }

  const artifacts = await verifyArtifacts(packageName, version)
  const notes = await loadReleaseNotes(version, tag, options.notesFile)

  if (options.dryRun) {
    console.log('Dry run complete. Nothing was pushed and nothing was sent to GitHub.')
    console.log(`Version: ${version}`)
    console.log(`Tag: ${tag} (${options.push ? 'would be created and pushed' : 'already on origin at HEAD'})`)
    console.log(`Branch: ${options.push ? `${branch} (would be pushed)` : `${branch} (not pushed)`}`)
    console.log(`Repository: ${repo}`)
    console.log(`Release: ${releaseName}, prerelease=${prerelease}, ${options.draft ? 'left as draft' : 'published after verification'}`)
    console.log(`Assets (upload order): ${artifacts.files.map((file) => file.name).join(', ')}`)
    console.log('Notes:\n' + notes)
    return
  }

  // Belirteç push'tan önce: belirteç yoksa veya yetkisizse etiket gitmez.
  const token = resolveGitHubToken()
  const api = createGitHubApi({ repo, token })
  const repository = await api.getRepository()
  if (repository?.permissions && repository.permissions.push !== true) {
    throw new Error(`The GitHub token has no push permission on ${repo}.`)
  }

  if (options.push) {
    createLocalTagAtHead(tag, headSha)
    console.log(`Pushing branch ${branch}...`)
    runLogged('git', ['push', 'origin', branch])
    console.log(`Pushing tag ${tag}...`)
    runLogged('git', ['push', 'origin', `refs/tags/${tag}`])
    const problem = remoteTagProblem(readRemoteTag(tag), tag, headSha)
    if (problem) throw new Error(`After push: ${problem}`)
  }

  console.log(`Preparing GitHub release on ${repo}...`)
  const release = await publishRelease({
    api,
    tag,
    // Etiket uzak depoda HEAD'de olduğu doğrulandı; GitHub onu kullanır.
    targetCommitish: headSha,
    releaseName,
    notes,
    prerelease,
    keepDraft: options.draft,
    files: artifacts.files,
    log: (message) => console.log(message)
  })

  console.log(`${release.draft ? 'Draft release ready' : 'Release published'}: ${release.html_url}`)
}

main().catch((error) => {
  console.error(`[release-win] ${errorMessage(error)}`)
  process.exit(1)
})
