#!/usr/bin/env node

// Uygulamayla dağıtılan npm paketlerinin lisans bildirimlerini
// node_modules'tan üretir: licenses/npm-packages.txt. Hangi paketin
// "dağıtılan" sayıldığı scripts/notices-lib.mjs'in başındaki açıklamada.
//
//   npm run notices:npm            dosyayı yeniden yazar
//   npm run notices:npm -- --check yalnızca güncel mi diye bakar (değilse çıkış 1)
//
// Bağımlılıklar değişince yeniden çalıştırıp çıktıyı commit edin.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EMBEDDED_BUILD_TOOLS,
  formatNotices,
  licenseOf,
  packageNameOf,
  pickLicenseFiles,
  repositoryUrl,
  runtimeImportsOfCss,
  runtimeImportsOfScript
} from './notices-lib.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUTPUT = join(ROOT, 'licenses', 'npm-packages.txt')
const SOURCE_DIR = join(ROOT, 'src')
const CHECK = process.argv.includes('--check')

/** @param {string} path */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.(?:[cm]?[jt]sx?|css)$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Node'un çözümleme sırasıyla `name` paketinin klasörü: `fromDir`'den köke
 * doğru her node_modules'a bakar.
 * @param {string} name
 * @param {string} fromDir
 * @returns {string | null}
 */
function resolvePackageDir(name, fromDir) {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    const parent = dirname(dir)
    if (parent === dir || relative(ROOT, parent).startsWith('..')) return null
    dir = parent
  }
}

/** @typedef {{ dir: string, reasons: Map<string, Set<string>> }} Found */

/** @type {Map<string, Found>} paket klasörü → kayıt */
const found = new Map()
const problems = []

/**
 * @param {string} dir
 * @param {string} channel
 * @param {string} reason
 */
function record(dir, channel, reason) {
  const entry = found.get(dir) ?? { dir, reasons: new Map() }
  found.set(dir, entry)
  const reasons = entry.reasons.get(channel) ?? new Set()
  entry.reasons.set(channel, reasons)
  reasons.add(reason)
}

/**
 * `dir`'deki paketi ve `dependencies` / kurulu `optionalDependencies`
 * ağacını kaydeder.
 * @param {string} dir
 * @param {string} channel
 */
function walkDependencies(dir, channel) {
  const queue = [dir]
  const seen = new Set()
  while (queue.length > 0) {
    const current = /** @type {string} */ (queue.shift())
    if (seen.has(current)) continue
    seen.add(current)
    const manifest = readJson(join(current, 'package.json'))
    const optional = manifest.optionalDependencies ?? {}
    const deps = { ...(manifest.dependencies ?? {}), ...optional }
    for (const name of Object.keys(deps)) {
      if (packageNameOf(name) === null) continue
      const child = resolvePackageDir(name, current)
      if (!child) {
        if (!(name in optional)) problems.push(`${manifest.name} bağımlılığı ${name} node_modules'ta yok`)
        continue
      }
      record(child, channel, `dependency of ${manifest.name}`)
      queue.push(child)
    }
  }
}

const ASAR = 'copied into app.asar (node_modules)'
const BUNDLED = 'bundled by Vite into out/'

// 1. Üretim bağımlılıkları → app.asar
const rootManifest = readJson(join(ROOT, 'package.json'))
for (const name of Object.keys(rootManifest.dependencies ?? {})) {
  const dir = resolvePackageDir(name, ROOT)
  if (!dir) {
    problems.push(`package.json bağımlılığı ${name} node_modules'ta yok; önce npm install`)
    continue
  }
  record(dir, ASAR, 'package.json dependency')
  walkDependencies(dir, ASAR)
}

// 2. src/ altında çalışma zamanında içe aktarılan paketler → Vite paketi
/** @type {Map<string, Set<string>>} paket adı → onu içe aktaran dosyalar */
const imported = new Map()
for (const file of sourceFiles(SOURCE_DIR)) {
  const source = readFileSync(file, 'utf8')
  const specifiers = file.endsWith('.css') ? runtimeImportsOfCss(source) : runtimeImportsOfScript(source, file)
  for (const specifier of specifiers) {
    const name = packageNameOf(specifier)
    if (!name) continue
    const files = imported.get(name) ?? new Set()
    files.add(relative(ROOT, file).split(sep).join('/'))
    imported.set(name, files)
  }
}
const runtimeDependencies = new Set(Object.keys(rootManifest.dependencies ?? {}))
for (const [name] of imported) {
  // Üretim bağımlılıkları Vite'ta dışarıda bırakılır (externalizeDepsPlugin);
  // onlar 1. adımda app.asar olarak sayıldı.
  if (runtimeDependencies.has(name)) continue
  const dir = resolvePackageDir(name, ROOT)
  if (!dir) {
    problems.push(`src/ ${name} paketini içe aktarıyor ama node_modules'ta yok`)
    continue
  }
  record(dir, BUNDLED, 'imported at run time by src/')
  walkDependencies(dir, BUNDLED)
}

// 3. Kendi kodunu çıktıya koyan derleme araçları (bağımlılıkları değil)
for (const [name, reason] of Object.entries(EMBEDDED_BUILD_TOOLS)) {
  const dir = resolvePackageDir(name, ROOT)
  if (!dir) {
    problems.push(`${name} node_modules'ta yok`)
    continue
  }
  record(dir, BUNDLED, reason)
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`[notices] ${problem}`)
  process.exit(1)
}

/** @type {import('./notices-lib.mjs').PackageNotice[]} */
const notices = [...found.values()].map(({ dir, reasons }) => {
  const manifest = readJson(join(dir, 'package.json'))
  const [licenseFile] = pickLicenseFiles(readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile()))
  return {
    name: manifest.name,
    version: manifest.version,
    license: licenseOf(manifest),
    repository: repositoryUrl(manifest.repository) ?? (typeof manifest.homepage === 'string' ? manifest.homepage : null),
    reasons: [...reasons].map(([channel, why]) => `${channel}: ${[...why].sort().join('; ')}`).sort(),
    licenseFile: licenseFile ?? null,
    licenseText: licenseFile ? readFileSync(join(dir, licenseFile), 'utf8') : null
  }
})

const text = formatNotices(notices)
const missing = notices.filter((notice) => !notice.licenseText).map((notice) => `${notice.name}@${notice.version}`)

if (CHECK) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n') : ''
  if (current !== text) {
    console.error('[notices] licenses/npm-packages.txt güncel değil: npm run notices:npm')
    process.exit(1)
  }
  console.log(`[notices] licenses/npm-packages.txt güncel (${notices.length} paket).`)
} else {
  writeFileSync(OUTPUT, text)
  console.log(`[notices] ${notices.length} paket yazıldı: ${relative(ROOT, OUTPUT)}`)
}
if (missing.length > 0) console.log(`[notices] Lisans dosyası olmayan paketler: ${missing.join(', ')}`)
