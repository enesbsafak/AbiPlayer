import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  formatNotices,
  licenseOf,
  packageNameOf,
  pickLicenseFiles,
  repositoryUrl,
  runtimeImportsOfCss,
  runtimeImportsOfScript
} from './notices-lib.mjs'

describe('packageNameOf', () => {
  it('alt yolu ve sorguyu atıp paket adını verir', () => {
    expect(packageNameOf('react-dom/client')).toBe('react-dom')
    expect(packageNameOf('zustand/middleware')).toBe('zustand')
    expect(packageNameOf('@fontsource-variable/dm-sans/files/x.woff2')).toBe('@fontsource-variable/dm-sans')
    expect(packageNameOf('hls.js?worker')).toBe('hls.js')
  })

  it('göreli yol, takma ad, Node yerleşikleri ve Electron için null döner', () => {
    for (const specifier of ['./a', '../b', '/c', '@/strings', 'fs', 'fs/promises', 'node:crypto', 'electron', 'https://x.test/a']) {
      expect(packageNameOf(specifier)).toBeNull()
    }
  })
})

describe('runtimeImportsOfScript', () => {
  it('yalnızca çalışma zamanında yüklenen belirteçleri sayar', () => {
    const source = [
      "import type { A } from 'types-only'",
      "import { type B, type C } from 'all-type-named'",
      "import { type D, value } from 'mixed'",
      "import Default from 'default-import'",
      "import 'side-effect'",
      "export { x } from 'reexport'",
      "export type { Y } from 'type-reexport'",
      "const lazy = () => import('dynamic')",
      "// import nope from 'in-comment'",
      "const text = \"from 'in-string'\""
    ].join('\n')
    expect(runtimeImportsOfScript(source).sort()).toEqual(
      ['default-import', 'dynamic', 'mixed', 'reexport', 'side-effect'].sort()
    )
  })
})

describe('runtimeImportsOfCss', () => {
  it('url() ve @import belirteçlerini yorumları ve data: adreslerini atlayarak verir', () => {
    const css = [
      '/* url(commented/out.woff2) */',
      "@import 'pkg/base.css';",
      'src: url(@fontsource-variable/dm-sans/files/a.woff2) format("woff2");',
      "background: url('data:image/png;base64,AAAA');"
    ].join('\n')
    expect(runtimeImportsOfCss(css)).toEqual(['pkg/base.css', '@fontsource-variable/dm-sans/files/a.woff2'])
  })
})

describe('repositoryUrl', () => {
  it('yaygın biçimleri https adresine çevirir', () => {
    expect(repositoryUrl('github:owner/repo')).toBe('https://github.com/owner/repo')
    expect(repositoryUrl('owner/repo')).toBe('https://github.com/owner/repo')
    expect(repositoryUrl({ type: 'git', url: 'git+https://github.com/a/b.git' })).toBe('https://github.com/a/b')
    expect(repositoryUrl({ url: 'git+https://github.com/a/b.git#v3' })).toBe('https://github.com/a/b#v3')
    expect(repositoryUrl({ url: 'git@github.com:a/b.git' })).toBe('https://github.com/a/b')
    expect(repositoryUrl(undefined)).toBeNull()
  })
})

describe('licenseOf', () => {
  it('license alanını, nesne biçimini ve eski licenses dizisini okur', () => {
    expect(licenseOf({ license: 'MIT' })).toBe('MIT')
    expect(licenseOf({ license: { type: 'ISC' } })).toBe('ISC')
    expect(licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('MIT OR Apache-2.0')
    expect(licenseOf({})).toBe('UNKNOWN')
  })
})

describe('pickLicenseFiles', () => {
  it('lisans dosyalarını tercih sırasıyla seçer', () => {
    expect(pickLicenseFiles(['README.md', 'LICENSE-MIT', 'license.md', 'COPYING', 'LICENSE', 'licensed.js'])).toEqual([
      'LICENSE',
      'license.md',
      'LICENSE-MIT',
      'COPYING'
    ])
  })
})

describe('licenses/npm-packages.txt', () => {
  it('bugünkü node_modules ile güncel (değilse: npm run notices:npm)', () => {
    const script = fileURLToPath(new URL('./generate-npm-notices.mjs', import.meta.url))
    expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow()
  })
})

describe('formatNotices', () => {
  it('paketleri ada göre sıralar, lisans metnini ve eksik metin notunu yazar', () => {
    const text = formatNotices([
      { name: 'b', version: '1.0.0', license: 'MIT', repository: null, reasons: ['r'], licenseFile: null, licenseText: null },
      { name: 'a', version: '2.0.0', license: 'ISC', repository: 'https://x.test/a', reasons: ['r'], licenseFile: 'LICENSE', licenseText: 'ISC text\r\n' }
    ])
    expect(text.indexOf('a 2.0.0')).toBeLessThan(text.indexOf('b 1.0.0'))
    expect(text).toContain('Source: https://x.test/a')
    expect(text).toContain('ISC text\n')
    expect(text).not.toContain('\r')
    expect(text).toContain('No licence file in the package')
    expect(text).toContain('2 packages.')
  })
})
