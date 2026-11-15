#!/usr/bin/env node

// Pakete giren mpv'yi kurar (F0-06). Kaynak her zaman scripts/mpv-pin.json'daki
// sabittir: sürüm etiketi, dosya adı, boyut ve SHA256 depoda durur. İndirilen
// dosya bu özetle tutmazsa derleme durur. Arşiv geçici klasöre açılır, hazırlık
// klasörü tamamlanınca resources/mpv/win32-x64 adına taşınır; yarım kurulum
// hedefte hiç görünmez. Sabiti yeni sürüme taşımak için: npm run update:mpv-pin

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { path7za } from '7zip-bin'
import {
  SOURCE_FILE_NAME,
  buildSourceInfo,
  downloadWithSha256,
  pinDownloadUrl,
  readPin,
  sourceMatchesPin
} from './mpv-lib.mjs'

const TARGET_DIR = join(process.cwd(), 'resources', 'mpv', 'win32-x64')
const TARGET_EXE = join(TARGET_DIR, 'mpv.exe')
const FORCE_DOWNLOAD = process.env['FORCE_MPV_DOWNLOAD'] === '1'
const DOWNLOAD_TIMEOUT_MS = Number(process.env['MPV_DOWNLOAD_TIMEOUT_MS']) || 10 * 60_000
const VERSION_CHECK_TIMEOUT_MS = 30_000

function log(message) {
  console.log(`[prepare-mpv] ${message}`)
}

function run(command, args, { timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve(stdout)
        return
      }

      const reason = signal ? `${signal} sinyaliyle durdu` : `kod ${code} ile çıktı`
      reject(new Error(stderr.trim() || `${basename(command)} ${reason}`))
    })
  })
}

async function readInstalledSource() {
  try {
    return JSON.parse(await readFile(join(TARGET_DIR, SOURCE_FILE_NAME), 'utf8'))
  } catch {
    return null
  }
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

// Önceki yarım çalıştırmalardan kalan hazırlık ve yedek klasörleri.
async function removeLeftovers(parentDir, baseName) {
  if (!existsSync(parentDir)) return
  for (const entry of await readdir(parentDir, { withFileTypes: true })) {
    if (entry.isDirectory() && /\.(staging|old)-[\w-]+$/.test(entry.name) && entry.name.startsWith(baseName)) {
      await rm(join(parentDir, entry.name), { recursive: true, force: true })
    }
  }
}

// Hedefle aynı birimde hazırlanan klasör tek adımda yerine taşınır. Eski kurulum
// önce kenara alınır; taşıma başarısız olursa geri konur.
async function swapIntoPlace(stagingDir) {
  const oldDir = `${TARGET_DIR}.old-${process.pid}`
  const hadPrevious = existsSync(TARGET_DIR)

  if (hadPrevious) {
    try {
      await rename(TARGET_DIR, oldDir)
    } catch (error) {
      throw new Error(
        `${TARGET_DIR} taşınamadı; mpv çalışıyor olabilir. Kapatıp yeniden deneyin.`,
        { cause: error }
      )
    }
  }

  try {
    await rename(stagingDir, TARGET_DIR)
  } catch (error) {
    if (hadPrevious) await rename(oldDir, TARGET_DIR)
    throw error
  }

  if (hadPrevious) await rm(oldDir, { recursive: true, force: true })
}

async function main() {
  if (process.platform !== 'win32') {
    log('Windows dışı ortamda MPV hazırlama atlandı.')
    return
  }

  const pin = await readPin()
  const label = `${pin.repository}@${pin.releaseTag} ${pin.assetName}`

  if (!FORCE_DOWNLOAD && existsSync(TARGET_EXE)) {
    const installed = await readInstalledSource()
    if (sourceMatchesPin(installed, pin)) {
      log(`MPV zaten hazır (${pin.releaseTag}): ${TARGET_EXE}`)
      return
    }
    const was = installed ? `${String(installed.releaseTag)} ${String(installed.assetName)}` : 'kaydı yok'
    log(`Kurulu MPV sabitle eşleşmiyor (${was}); yeniden kuruluyor.`)
  }

  const parentDir = dirname(TARGET_DIR)
  await mkdir(parentDir, { recursive: true })
  await removeLeftovers(parentDir, basename(TARGET_DIR))

  const tempRoot = await mkdtemp(join(tmpdir(), 'abi-player-mpv-'))
  const archivePath = join(tempRoot, pin.assetName)
  const extractDir = join(tempRoot, 'extract')
  const stagingDir = `${TARGET_DIR}.staging-${process.pid}`

  try {
    log(`${label} indiriliyor...`)
    const downloaded = await downloadWithSha256(pinDownloadUrl(pin), archivePath, DOWNLOAD_TIMEOUT_MS)

    if (downloaded.sha256 !== pin.sha256 || downloaded.size !== pin.size) {
      throw new Error(
        'İndirilen mpv sabitle eşleşmiyor; derleme durduruldu.\n' +
          `  beklenen: sha256=${pin.sha256} boyut=${pin.size}\n` +
          `  alınan:   sha256=${downloaded.sha256} boyut=${downloaded.size}`
      )
    }
    log('SHA256 sabitle eşleşti.')

    log('Arşiv açılıyor...')
    await mkdir(extractDir, { recursive: true })
    await run(path7za, ['x', archivePath, `-o${extractDir}`, '-y'])

    const mpvDir = await findDirectoryContainingFile(extractDir, 'mpv.exe')
    if (!mpvDir) {
      throw new Error('Arşivde mpv.exe bulunamadı.')
    }

    await rm(stagingDir, { recursive: true, force: true })
    await cp(mpvDir, stagingDir, { recursive: true })

    const versionOutput = await run(join(stagingDir, 'mpv.exe'), ['--version'], {
      timeoutMs: VERSION_CHECK_TIMEOUT_MS
    })
    log(versionOutput.split(/\r?\n/)[0] ?? 'mpv --version çalıştı')

    await writeFile(
      join(stagingDir, SOURCE_FILE_NAME),
      `${JSON.stringify(buildSourceInfo(pin), null, 2)}\n`
    )

    await swapIntoPlace(stagingDir)
    log(`MPV hazırlandı: ${TARGET_EXE}`)
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[prepare-mpv] Hata: ${message}`)
  process.exit(1)
})
