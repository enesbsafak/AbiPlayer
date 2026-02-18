#!/usr/bin/env node

import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, existsSync } from 'fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { path7za } from '7zip-bin'

const MPV_RELEASE_API =
  'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest'
const TARGET_DIR = join(process.cwd(), 'resources', 'mpv', 'win32-x64')
const TARGET_EXE = join(TARGET_DIR, 'mpv.exe')
const FORCE_DOWNLOAD = process.env['FORCE_MPV_DOWNLOAD'] === '1'

function log(message) {
  console.log(`[prepare-mpv] ${message}`)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'abi-player-build'
    }
  })

  if (!response.ok) {
    throw new Error(`GitHub API hatasi (${response.status}): ${response.statusText}`)
  }

  return response.json()
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'abi-player-build'
    }
  })

  if (!response.ok || !response.body) {
    throw new Error(`Dosya indirilemedi (${response.status}): ${response.statusText}`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destinationPath))
}

async function verifyFileSha256(filePath, expectedSha256) {
  const fileBuffer = await readFile(filePath)
  const actualSha256 = createHash('sha256').update(fileBuffer).digest('hex')
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error(
      `SHA256 dogrulama basarisiz. Beklenen=${expectedSha256}, Alinan=${actualSha256}`
    )
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      const message = stderr.trim() || `${command} kod ${code} ile cikti`
      reject(new Error(message))
    })
  })
}

async function extractArchive(archivePath, outputDir) {
  await run(path7za, ['x', archivePath, `-o${outputDir}`, '-y'])
}

async function findDirectoryContainingFile(rootDir, fileName) {
  const stack = [rootDir]
  const targetName = fileName.toLowerCase()

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break

    const entries = await readdir(current, { withFileTypes: true })
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === targetName)) {
      return current
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(join(current, entry.name))
      }
    }
  }

  return null
}

async function copyDirectoryContents(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    await cp(join(sourceDir, entry.name), join(targetDir, entry.name), {
      recursive: true,
      force: true
    })
  }
}

function pickMpvAsset(assets) {
  return assets.find((asset) => {
    if (!isObject(asset) || typeof asset.name !== 'string') return false
    return (
      asset.name.startsWith('mpv-x86_64-') &&
      asset.name.endsWith('.7z') &&
      !asset.name.includes('-v3-') &&
      !asset.name.includes('debug') &&
      !asset.name.includes('dev')
    )
  })
}

function getAssetSha256(asset) {
  if (!isObject(asset) || typeof asset.digest !== 'string') return null
  if (!asset.digest.startsWith('sha256:')) return null
  return asset.digest.slice('sha256:'.length).trim().toLowerCase()
}

async function main() {
  if (process.platform !== 'win32') {
    log('Windows disi ortamda MPV hazirlama atlandi.')
    return
  }

  if (!FORCE_DOWNLOAD && existsSync(TARGET_EXE)) {
    log(`MPV zaten hazir: ${TARGET_EXE}`)
    return
  }

  const release = await fetchJson(MPV_RELEASE_API)
  const assets = Array.isArray(release.assets) ? release.assets : []
  const asset = pickMpvAsset(assets)

  if (!asset || typeof asset.browser_download_url !== 'string' || typeof asset.name !== 'string') {
    throw new Error('Uygun x64 MPV release asset bulunamadi.')
  }

  const expectedSha256 = getAssetSha256(asset)
  const tempRoot = await mkdtemp(join(tmpdir(), 'abi-player-mpv-'))
  const archivePath = join(tempRoot, asset.name)
  const extractDir = join(tempRoot, 'extract')

  try {
    await mkdir(extractDir, { recursive: true })

    log(`${asset.name} indiriliyor...`)
    await downloadFile(asset.browser_download_url, archivePath)

    if (expectedSha256) {
      log('SHA256 dogrulaniyor...')
      await verifyFileSha256(archivePath, expectedSha256)
    }

    log('Arsiv aciliyor...')
    await extractArchive(archivePath, extractDir)

    const mpvDir = await findDirectoryContainingFile(extractDir, 'mpv.exe')
    if (!mpvDir) {
      throw new Error('Arsivde mpv.exe bulunamadi.')
    }

    await rm(TARGET_DIR, { recursive: true, force: true })
    await mkdir(TARGET_DIR, { recursive: true })
    await copyDirectoryContents(mpvDir, TARGET_DIR)

    const sourceInfo = {
      releaseTag: typeof release.tag_name === 'string' ? release.tag_name : null,
      assetName: asset.name,
      assetUrl: asset.browser_download_url,
      sha256: expectedSha256,
      downloadedAt: new Date().toISOString(),
      repository: 'shinchiro/mpv-winbuild-cmake'
    }

    await writeFile(join(TARGET_DIR, '.mpv-source.json'), `${JSON.stringify(sourceInfo, null, 2)}\n`)
    log(`MPV hazirlandi: ${TARGET_EXE}`)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[prepare-mpv] Hata: ${message}`)
  process.exit(1)
})
