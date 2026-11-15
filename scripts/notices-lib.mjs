// Uygulamayla dağıtılan npm paketlerinin lisans bildirimlerini toplayan saf
// yardımcılar. Dosya sistemi işi scripts/generate-npm-notices.mjs'tedir.
//
// "Dağıtılan paket" iki yoldan gelir:
// 1. package.json `dependencies`: electron-builder bunları ve bağımlılık
//    ağaçlarını app.asar içindeki node_modules'a koyar (electron-updater).
// 2. Vite'in paketlere gömdüğü kod: src/ altındaki test dışı kaynakların
//    değer olarak içe aktardığı paketler (`import type` sayılmaz), CSS'in
//    url() ile çektiği dosyalar (yazı tipleri) ve bunların `dependencies`
//    ağaçları. Ağaç sarsma bir kısmını pakete hiç sokmayabilir; liste bu
//    yüzden eksik değil, gerekirse fazla tarafta kalır.
// Ayrıca kaynakta içe aktarılmadığı hâlde çıktıya kod koyan iki derleme aracı
// elle eklenir (EMBEDDED_BUILD_TOOLS).

import { builtinModules } from 'node:module'
import ts from 'typescript'

/**
 * Kod içe aktarılmadan pakete giren derleme araçları; değer, bildirim
 * dosyasına (İngilizce) yazılan nedendir.
 */
export const EMBEDDED_BUILD_TOOLS = {
  vite: 'build tool; injects its module preload helper into the renderer bundle',
  tailwindcss: 'build tool; its base styles (preflight) are part of the generated CSS'
}

/** Electron çalışma zamanı ayrı listelenir; npm listesine girmez. */
const RUNTIME_PROVIDED = new Set(['electron'])

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i

/**
 * Bir içe aktarma belirtecinin paket adı; göreli yol, mutlak yol, Node
 * yerleşik modülü, takma ad (`@/…`) veya Electron ise null.
 * @param {string} specifier
 * @returns {string | null}
 */
export function packageNameOf(specifier) {
  const clean = specifier.split('?')[0] ?? ''
  if (!clean || clean.startsWith('.') || clean.startsWith('/') || clean.startsWith('@/')) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) && !clean.startsWith('node:')) return null
  const parts = clean.split('/')
  const name = clean.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '')
  if (BUILTINS.has(name) || BUILTINS.has(clean) || clean.startsWith('node:')) return null
  if (RUNTIME_PROVIDED.has(name)) return null
  return PACKAGE_NAME.test(name) ? name : null
}

/**
 * TypeScript/TSX kaynağının çalışma zamanında yüklediği belirteçler:
 * değer içe aktarmaları, yeniden dışa aktarmalar, yan etki içe aktarmaları,
 * dinamik `import()` ve `require()`. Yalnızca tür içe aktaranlar sayılmaz.
 * @param {string} source
 * @param {string} [fileName]
 * @returns {string[]}
 */
export function runtimeImportsOfScript(source, fileName = 'module.tsx') {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  /** @type {string[]} */
  const found = []

  /** @param {import('typescript').Node} node */
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!isTypeOnlyImport(node)) found.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) found.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node)) {
      const [first] = node.arguments
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if ((isDynamicImport || isRequire) && first && ts.isStringLiteralLike(first)) found.push(first.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** @param {import('typescript').ImportDeclaration} node */
function isTypeOnlyImport(node) {
  const clause = node.importClause
  if (!clause) return false // import 'x'
  if (clause.isTypeOnly) return true
  // `import { type A, type B } from 'x'` derlemeden sonra silinir.
  const bindings = clause.namedBindings
  return (
    !clause.name &&
    !!bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  )
}

/**
 * CSS'in `@import` ve `url()` ile çektiği belirteçler (yorumlar atlanır).
 * @param {string} source
 * @returns {string[]}
 */
export function runtimeImportsOfCss(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  /** @type {string[]} */
  const found = []
  for (const match of css.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/g)) {
    if (match[1]) found.push(match[1])
  }
  for (const match of css.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g)) {
    if (match[1] && !match[1].startsWith('data:')) found.push(match[1])
  }
  return found
}

/**
 * package.json'daki `repository` alanından okunabilir bir adres.
 * @param {unknown} repository
 * @returns {string | null}
 */
export function repositoryUrl(repository) {
  const raw =
    typeof repository === 'string'
      ? repository
      : repository && typeof repository === 'object' && 'url' in repository && typeof repository.url === 'string'
        ? repository.url
        : null
  if (!raw) return null
  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(raw)
  if (shorthand) return `https://github.com/${shorthand[1]}`
  return raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git(?=#|$)/, '')
}

/**
 * package.json'daki lisans alanı (eski `licenses` dizisi dahil).
 * @param {Record<string, unknown>} manifest
 * @returns {string}
 */
export function licenseOf(manifest) {
  const { license, licenses } = manifest
  if (typeof license === 'string' && license.trim()) return license.trim()
  if (license && typeof license === 'object' && 'type' in license && typeof license.type === 'string') return license.type
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((entry) => (entry && typeof entry === 'object' && 'type' in entry ? entry.type : null))
      .filter((type) => typeof type === 'string')
    if (types.length > 0) return types.join(' OR ')
  }
  return 'UNKNOWN'
}

/** Lisans metni sayılan dosya adları, tercih sırasıyla. */
const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[.-].*)?$/i

/**
 * Bir paket klasöründeki lisans dosyası adlarını tercih sırasıyla döndürür.
 * @param {string[]} fileNames
 * @returns {string[]}
 */
export function pickLicenseFiles(fileNames) {
  return fileNames
    .filter((name) => LICENSE_FILE.test(name))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** @param {string} name */
function rank(name) {
  const lower = name.toLowerCase()
  if (lower === 'license' || lower === 'licence') return 0
  if (/^licen[cs]e\.(md|txt)$/.test(lower)) return 1
  if (lower.startsWith('licen')) return 2
  return 3
}

/**
 * @typedef {object} PackageNotice
 * @property {string} name
 * @property {string} version
 * @property {string} license
 * @property {string | null} repository
 * @property {string[]} reasons
 * @property {string | null} licenseFile
 * @property {string | null} licenseText
 */

const RULE = '='.repeat(78)
const THIN_RULE = '-'.repeat(78)

/**
 * Bildirim dosyasının metni. Tarih veya makineye özgü yol içermez; aynı
 * node_modules her zaman aynı çıktıyı verir (`--check` buna dayanır).
 * @param {PackageNotice[]} notices
 * @returns {string}
 */
export function formatNotices(notices) {
  const sorted = [...notices].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  const header = [
    'Abi Player - npm packages shipped inside the application',
    '',
    'Generated by scripts/generate-npm-notices.mjs from node_modules. Do not edit',
    'by hand; run `npm run notices:npm` after changing dependencies.',
    '',
    'A package is listed when (a) it is a production dependency in package.json',
    'or one of their dependencies (copied into app.asar by electron-builder), or',
    '(b) code or files from it are bundled by Vite: it is imported at run time by',
    'non-test source under src/, or it is a dependency of such a package, or it',
    'is a build tool that injects its own code into the output. Bundling may',
    'leave some of the (b) packages out; the list errs on the side of including.',
    '',
    `${sorted.length} packages.`,
    ''
  ]
  const blocks = sorted.map((notice) => {
    const lines = [
      RULE,
      `${notice.name} ${notice.version}`,
      `License: ${notice.license}`,
      ...(notice.repository ? [`Source: ${notice.repository}`] : []),
      ...notice.reasons.map((reason) => `Included: ${reason}`),
      THIN_RULE
    ]
    if (notice.licenseText) {
      lines.push(notice.licenseText.replace(/\r\n?/g, '\n').trimEnd())
    } else {
      lines.push(`(No licence file in the package; the licence above is from its package.json.)`)
    }
    lines.push('')
    return lines.join('\n')
  })
  return [...header, ...blocks].join('\n')
}
