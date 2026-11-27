import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/*
 * Keeps user-facing Turkish text in the dictionaries: the renderer's
 * src/renderer/src/strings and main's src/shared/main-strings.ts.
 *
 * Every .ts/.tsx source outside those, outside tests and test helpers, is
 * parsed with the TypeScript compiler, and every string literal, template
 * piece and JSX text that contains a Turkish-specific letter is reported.
 * Comments and regular expressions are not literals, so they never count.
 *
 * Not caught: Turkish text without any of those letters ("Kaynak", "Oto",
 * "M3U listesi indirilemedi"), English text shown to the user, and text put
 * together from pieces that each pass.
 */

const ROOT = process.cwd()
const TURKISH_LETTER = /[çğıöşüÇĞİÖŞÜ]/

/** Literals that are data, not text for the user: path → literals allowed there. */
const ALLOWED: Record<string, readonly string[]> = {
  // Release-name tags that title matching strips before asking TMDB.
  'src/renderer/src/services/tmdb-match.ts': ['türkçe\\s+dublaj', 'dublajlı', 'tr\\s+altyazı', 'altyazılı', 'altyazı'],
  // The word playlists mark an episode with, as a pattern that matches entry names.
  'src/renderer/src/services/m3u-series.ts': ['b[öo]l[üu]m']
}

function isExcluded(path: string): boolean {
  const parts = path.split('/')
  return (
    /\.test\.tsx?$/.test(path) ||
    /\.d\.ts$/.test(path) ||
    parts.includes('testing') ||
    path.startsWith('src/renderer/src/strings/') ||
    path === 'src/shared/main-strings.ts'
  )
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !isExcluded(path) ? [path] : []
  })
}

/** Literals of one file that contain a Turkish letter. */
function turkishLiterals(path: string, source: string): Array<{ line: number; text: string }> {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: Array<{ line: number; text: string }> = []
  const visit = (node: ts.Node): void => {
    let text: string | null = null
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text
    } else if (ts.isJsxText(node)) {
      text = node.text.trim()
    }
    if (text && TURKISH_LETTER.test(text)) {
      found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** Turkish literals of one file that are not allowed there, as "path:line: text". */
function strayTurkishText(path: string, source: string): string[] {
  const allowed = new Set(ALLOWED[path] ?? [])
  return turkishLiterals(path, source)
    .filter(({ text }) => !allowed.has(text))
    .map(({ line, text }) => `${path}:${line}: ${text}`)
}

function strayIn(dirs: readonly string[]): string[] {
  return dirs.flatMap((dir) =>
    sourceFiles(dir).flatMap((path) => strayTurkishText(path, readFileSync(join(ROOT, path), 'utf8')))
  )
}

describe('user-facing text stays in the dictionaries', () => {
  it('finds a literal, a template piece and JSX text, and skips comments and regular expressions', () => {
    const source = [
      "// Yorum: çalışmaz",
      "const pattern = /bağlanılamadı/",
      "const a = 'Bağlantı kesildi'",
      'const b = `${a} yeniden bağlanılıyor`',
      'const c = <p>Yükleniyor</p>',
      "const d = 'plain'"
    ].join('\n')
    expect(strayTurkishText('src/renderer/src/example.tsx', source)).toEqual([
      'src/renderer/src/example.tsx:3: Bağlantı kesildi',
      'src/renderer/src/example.tsx:4:  yeniden bağlanılıyor',
      'src/renderer/src/example.tsx:5: Yükleniyor'
    ])
  })

  it('has no Turkish text in renderer code outside src/renderer/src/strings', () => {
    expect(strayIn(['src/renderer/src'])).toEqual([])
  })

  it('has no Turkish text in main, preload or shared code outside src/shared/main-strings.ts', () => {
    expect(strayIn(['src/main', 'src/preload', 'src/shared'])).toEqual([])
  })

  it('keeps the allow-list current', () => {
    const unused = Object.entries(ALLOWED).flatMap(([path, literals]) => {
      const present = new Set(turkishLiterals(path, readFileSync(join(ROOT, path), 'utf8')).map(({ text }) => text))
      return literals.filter((literal) => !present.has(literal)).map((literal) => `${path}: ${literal}`)
    })
    expect(unused).toEqual([])
  })
})
