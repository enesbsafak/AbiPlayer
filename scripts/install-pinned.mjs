// Sabitlenmiş bir arşivi kurar (prepare-mpv-win.mjs, prepare-ffmpeg-win.mjs).
// İndirilen dosya sabitteki boyut ve SHA256 ile tutmazsa kurulum durur. Arşiv
// geçici klasöre açılır, hedefle aynı birimdeki hazırlık klasörü tamamlanıp
// denendikten sonra tek adımda hedefin yerine taşınır; yarım kurulum hedefte
// hiç görünmez.

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { path7za } from '7zip-bin'
import { buildSourceInfo, downloadWithSha256, pinDownloadUrl, sourceMatchesPin } from './pin-lib.mjs'

export function run(command, args, { timeoutMs } = {}) {
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

async function readInstalledSource(targetDir, sourceFileName) {
  try {
    return JSON.parse(await readFile(join(targetDir, sourceFileName), 'utf8'))
  } catch {
    return null
  }
}

export async function findDirectoryContainingFile(rootDir, fileName) {
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

// Eski kurulum önce kenara alınır; taşıma başarısız olursa geri konur.
async function swapIntoPlace(stagingDir, targetDir, busyHint) {
  const oldDir = `${targetDir}.old-${process.pid}`
  const hadPrevious = existsSync(targetDir)

  if (hadPrevious) {
    try {
      await rename(targetDir, oldDir)
    } catch (error) {
      throw new Error(`${targetDir} taşınamadı; ${busyHint} Kapatıp yeniden deneyin.`, { cause: error })
    }
  }

  try {
    await rename(stagingDir, targetDir)
  } catch (error) {
    if (hadPrevious) await rename(oldDir, targetDir)
    throw error
  }

  if (hadPrevious) await rm(oldDir, { recursive: true, force: true })
}

/**
 * @param {object} options
 * @param {string} options.name            günlük öneki ve iletiler için ad (ör. 'MPV')
 * @param {object} options.pin             doğrulanmış sabit
 * @param {string} options.targetDir       kurulum klasörü
 * @param {string} options.markerFile      kurulumun var sayıldığı dosya (targetDir içinde)
 * @param {string} options.sourceFileName  kurulu kaynak kaydının adı
 * @param {boolean} options.force          kayıt eşleşse de yeniden kur
 * @param {number} options.downloadTimeoutMs
 * @param {string} options.busyHint        hedef taşınamazsa gösterilecek neden
 * @param {(extractDir: string, stagingDir: string) => Promise<void>} options.stage
 *        açılan arşivden gereken dosyaları hazırlık klasörüne kopyalar
 * @param {(stagingDir: string) => Promise<string[]>} options.verify
 *        hazırlık klasöründeki ikilileri çalıştırır; günlüğe yazılacak satırları döner
 * @param {(message: string) => void} options.log
 */
export async function installPinned(options) {
  const { name, pin, targetDir, markerFile, sourceFileName, log } = options
  const label = `${pin.repository}@${pin.releaseTag} ${pin.assetName}`

  if (!options.force && existsSync(join(targetDir, markerFile))) {
    const installed = await readInstalledSource(targetDir, sourceFileName)
    if (sourceMatchesPin(installed, pin)) {
      log(`${name} zaten hazır (${pin.releaseTag}): ${targetDir}`)
      return
    }
    const was = installed ? `${String(installed.releaseTag)} ${String(installed.assetName)}` : 'kaydı yok'
    log(`Kurulu ${name} sabitle eşleşmiyor (${was}); yeniden kuruluyor.`)
  }

  const parentDir = dirname(targetDir)
  await mkdir(parentDir, { recursive: true })
  await removeLeftovers(parentDir, basename(targetDir))

  const tempRoot = await mkdtemp(join(tmpdir(), `abi-player-${name.toLowerCase()}-`))
  const archivePath = join(tempRoot, pin.assetName)
  const extractDir = join(tempRoot, 'extract')
  const stagingDir = `${targetDir}.staging-${process.pid}`

  try {
    log(`${label} indiriliyor...`)
    const downloaded = await downloadWithSha256(pinDownloadUrl(pin), archivePath, options.downloadTimeoutMs)

    if (downloaded.sha256 !== pin.sha256 || downloaded.size !== pin.size) {
      throw new Error(
        `İndirilen ${name} sabitle eşleşmiyor; derleme durduruldu.\n` +
          `  beklenen: sha256=${pin.sha256} boyut=${pin.size}\n` +
          `  alınan:   sha256=${downloaded.sha256} boyut=${downloaded.size}`
      )
    }
    log('SHA256 sabitle eşleşti.')

    log('Arşiv açılıyor...')
    await mkdir(extractDir, { recursive: true })
    await run(path7za, ['x', archivePath, `-o${extractDir}`, '-y'])

    await rm(stagingDir, { recursive: true, force: true })
    await mkdir(stagingDir, { recursive: true })
    await options.stage(extractDir, stagingDir)

    for (const line of await options.verify(stagingDir)) log(line)

    await writeFile(join(stagingDir, sourceFileName), `${JSON.stringify(buildSourceInfo(pin), null, 2)}\n`)

    await swapIntoPlace(stagingDir, targetDir, options.busyHint)
    log(`${name} hazırlandı: ${targetDir}`)
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
    await rm(tempRoot, { recursive: true, force: true })
  }
}

export function firstLine(output, fallback) {
  return output.split(/\r?\n/).find((line) => line.trim()) ?? fallback
}
