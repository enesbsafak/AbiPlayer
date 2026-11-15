import { describe, expect, it } from 'vitest'
import { strings } from './index'

/** Every text of the dictionary, functions called with sample arguments. */
function collect(value: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof value === 'string') {
    out.push([path, value])
  } else if (typeof value === 'function') {
    // Numbers cover counts and minutes (a boolean parameter reads them as
    // true or false), strings cover names and labels.
    const fn = value as (...args: unknown[]) => unknown
    for (const sample of [0, 1, 2, 59, 61, 120]) {
      collect(fn(...Array.from({ length: fn.length }, () => sample)), `${path}(${sample})`, out)
    }
    collect(fn(...Array.from({ length: fn.length }, (_, index) => `Ad ${index}`)), `${path}('Ad')`, out)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collect(child, path ? `${path}.${key}` : key, out)
  }
}

const entries: Array<[string, string]> = []
collect(strings, '', entries)

/**
 * Words that have been written without their Turkish letters somewhere in
 * this app before. Matched as whole words, case-insensitively.
 */
const UNACCENTED = [
  'Yonetmen',
  'olustu',
  'Seciniz',
  'Henuz',
  'Guncelle',
  'Guncelleme',
  'Yukle',
  'Yukleniyor',
  'Baslat',
  'Gecersiz',
  'Islem',
  'Ayarlari',
  'Iptal',
  'Gorunum',
  'Sifre',
  'Kullanici',
  'Baglan',
  'Baglanti',
  'Altyazi',
  'Sec',
  'Dosya Sec',
  'Lutfen',
  'Basarisiz',
  'Ses Kanali',
  'Goruntu',
  'icerik',
  'Yayin',
  'Bulunamadi',
  'Hata olustu',
  'Duraklatildi'
]

describe('interface text dictionary', () => {
  it('has text for every entry, in every form', () => {
    expect(entries.length).toBeGreaterThan(300)
    const empty = entries.filter(([, text]) => text.trim() === '').map(([path]) => path)
    expect(empty).toEqual([])
  })

  it('writes Turkish words with their Turkish letters', () => {
    const offenders = entries.flatMap(([path, text]) =>
      UNACCENTED.filter((word) => new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, 'iu').test(text)).map(
        (word) => `${path}: "${word}" in "${text}"`
      )
    )
    expect(offenders).toEqual([])
  })

  it('leaves no placeholder or doubled space behind', () => {
    const broken = entries
      .filter(([, text]) => /undefined|null|\[object |\{\w+\}| {2}/.test(text))
      .map(([path, text]) => `${path}: "${text}"`)
    expect(broken).toEqual([])
  })

  it('points at settings tabs by the names they are shown with', () => {
    expect(strings.catalog.categories.hiddenHint(1)).toBe(
      `1 kategori gizli. Ayarlar → ${strings.settings.tabs.catalog.label} bölümünden geri getirebilirsiniz.`
    )
    expect(strings.security.trust.manageHint).toContain(`Ayarlar → ${strings.settings.tabs.sources.label}`)
    expect(strings.sources.credentials.lossMessage(null)).toContain(`Ayarlar → ${strings.settings.tabs.sources.label}`)
  })

  it('formats counts for Turkish readers', () => {
    expect(strings.common.resultCount(12345)).toBe('12.345 sonuç')
    expect(strings.catalog.home.remaining(0)).toBe('Az kaldı')
    expect(strings.catalog.home.remaining(61)).toBe('1 sa 1 dk kaldı')
    expect(strings.catalog.home.remaining(120)).toBe('2 sa kaldı')
  })
})
