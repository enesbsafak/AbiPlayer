import { describe, expect, it } from 'vitest'
import { mainStrings } from '../../../shared/main-strings'
import { strings } from './index'

/** Every text of a dictionary, functions called with sample arguments. */
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

function entriesOf(dictionary: object): Array<[string, string]> {
  const out: Array<[string, string]> = []
  collect(dictionary, '', out)
  return out
}

const entries = entriesOf(strings)
const mainEntries = entriesOf(mainStrings)

/**
 * Words that have been written without their Turkish letters somewhere in
 * this app before. Matched as whole words, case-insensitively; a pattern is
 * used as it is ("iptal" is right, "Iptal" is not).
 */
const UNACCENTED: Array<string | RegExp> = [
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
  /(^|[^\p{L}])Iptal/u,
  'Gorunum',
  'Sifre',
  'Kullanici',
  'Baglan',
  'Baglanti',
  'Baglanilamadi',
  'Ulasilamadi',
  'Dogrulama',
  'Guvenli',
  'Surum',
  'Cevrimdisi',
  'Onbellek',
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

/** Wordings the dictionary settled on, and the forms they replaced. */
const TERM_CHOICES: Array<[RegExp, string]> = [
  [/kimlik bilgi/i, 'giriş bilgileri ("kimlik doğrulama" stays)'],
  [/\bEPG\b/, 'yayın akışı'],
  [/\bURL\b/, 'adres'],
  [/(^|[^\p{L}])format/iu, 'biçim'],
  [/(^|[^\p{L}])detay/iu, 'ayrıntı'],
  [/(^|[^\p{L}])önizleme/iu, 'ön izleme'],
  [/denetlen/i, 'kontrol edil'],
  [/Ayarlar >/, 'settingsPath(tab): "Ayarlar → …"'],
  [/Başlat ve Yükle/, '"Yeniden Başlat ve Kur" (updates are installed: "kur")']
]

function unaccentedOffenders(list: Array<[string, string]>): string[] {
  return list.flatMap(([path, text]) =>
    UNACCENTED.filter((word) =>
      typeof word === 'string' ? new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, 'iu').test(text) : word.test(text)
    ).map((word) => `${path}: "${String(word)}" in "${text}"`)
  )
}

function termOffenders(list: Array<[string, string]>): string[] {
  return list.flatMap(([path, text]) =>
    TERM_CHOICES.filter(([pattern]) => pattern.test(text)).map(([, preferred]) => `${path}: "${text}" (use ${preferred})`)
  )
}

function brokenEntries(list: Array<[string, string]>): string[] {
  return list
    .filter(([, text]) => /undefined|null|\[object |\{\w+\}|\$\{| {2}/.test(text))
    .map(([path, text]) => `${path}: "${text}"`)
}

describe('interface text dictionary', () => {
  it('has text for every entry, in every form', () => {
    expect(entries.length).toBeGreaterThan(400)
    const empty = entries.filter(([, text]) => text.trim() === '').map(([path]) => path)
    expect(empty).toEqual([])
  })

  it('writes Turkish words with their Turkish letters', () => {
    expect(unaccentedOffenders(entries)).toEqual([])
  })

  it('keeps to the chosen terms', () => {
    expect(termOffenders(entries)).toEqual([])
  })

  it('leaves no placeholder or doubled space behind', () => {
    expect(brokenEntries(entries)).toEqual([])
  })

  it('points at settings tabs by the names they are shown with', () => {
    expect(strings.catalog.categories.hiddenHint(1)).toBe(
      `1 kategori gizli. Ayarlar → ${strings.settings.tabs.catalog.label} bölümünden geri getirebilirsin.`
    )
    expect(strings.security.trust.manageHint).toContain(`Ayarlar → ${strings.settings.tabs.sources.label}`)
    expect(strings.sources.credentials.lossMessage(null)).toContain(`Ayarlar → ${strings.settings.tabs.sources.label}`)
    expect(strings.errors.kinds.certificate).toContain(`Ayarlar → ${strings.settings.tabs.sources.label} → ${strings.security.trusted.title}`)
    expect(strings.sources.connect.missingXtreamSecret).toContain(`Ayarlar → ${strings.settings.tabs.sources.label}`)
    expect(strings.sources.connect.fileNotPicked(null)).toContain(`"${strings.sources.manager.repickFile}"`)
  })

  it('formats counts for Turkish readers', () => {
    expect(strings.common.resultCount(12345)).toBe('12.345 sonuç')
    expect(strings.catalog.home.remaining(0)).toBe('Az kaldı')
    expect(strings.catalog.home.remaining(61)).toBe('1 sa 1 dk kaldı')
    expect(strings.catalog.home.remaining(120)).toBe('2 sa kaldı')
  })

  it('names unlabelled tracks the same way for both engines', () => {
    expect(strings.player.audio.fallback(2)).toBe('Ses 2')
    expect(strings.player.subtitles.fallback(3)).toBe('Altyazı 3')
  })
})

describe('main process text', () => {
  it('has text for every entry, in every form', () => {
    expect(mainEntries.length).toBeGreaterThan(80)
    expect(mainEntries.filter(([, text]) => text.trim() === '').map(([path]) => path)).toEqual([])
  })

  it('writes Turkish words with their Turkish letters', () => {
    expect(unaccentedOffenders(mainEntries)).toEqual([])
  })

  it('keeps to the terms the renderer chose', () => {
    expect(termOffenders(mainEntries)).toEqual([])
  })

  it('leaves no placeholder or doubled space behind', () => {
    expect(brokenEntries(mainEntries)).toEqual([])
  })

  it('says the same as the renderer where both describe one state', () => {
    expect(mainStrings.updates.notAvailable).toBe(strings.settings.updates.status.notAvailable)
    expect(mainStrings.updates.idle).toBe(strings.settings.updates.status.idle)
    expect(mainStrings.updates.unsupported).toBe(strings.shell.update.installedOnly)
    expect(mainStrings.updates.dialog.install).toBe(strings.settings.updates.restartAndInstall)
    expect(mainStrings.files.playlistFilter).toBe(strings.sources.m3u.fileFilter)
    expect(mainStrings.files.subtitleFilter).toBe(strings.player.subtitles.fileFilter)
  })
})
