import { describe, expect, it, vi } from 'vitest'
import { decodeXmlEntities, normalizeEpgChannelKey, pickLocalizedText } from './epg-service'
import { createXmltvParser, fetchAndParseEPG, parseEPGXml } from './xmltv-parser'

describe('normalizeEpgChannelKey', () => {
  it('lowercases ASCII channel ids consistently', () => {
    // Full ICU is not guaranteed in every Node runtime, so we only assert the
    // baseline: same string lowercased, equal for case variants of the same id.
    const lower = normalizeEpgChannelKey('TRT1')
    expect(lower).toBe('trt1')
    expect(normalizeEpgChannelKey('trt1')).toBe(lower)
  })

  it('returns null for empty or unsafe keys', () => {
    expect(normalizeEpgChannelKey('')).toBeNull()
    expect(normalizeEpgChannelKey(null)).toBeNull()
    expect(normalizeEpgChannelKey(undefined)).toBeNull()
    expect(normalizeEpgChannelKey('__proto__')).toBeNull()
    expect(normalizeEpgChannelKey('constructor')).toBeNull()
    expect(normalizeEpgChannelKey('prototype')).toBeNull()
  })
})

describe('decodeXmlEntities', () => {
  it('decodes the five predefined XML entities', () => {
    expect(decodeXmlEntities('Tom &amp; Jerry')).toBe('Tom & Jerry')
    expect(decodeXmlEntities('&lt;b&gt;')).toBe('<b>')
    expect(decodeXmlEntities('&quot;Special&quot;')).toBe('"Special"')
    expect(decodeXmlEntities("Anne&apos;nin")).toBe("Anne'nin")
  })

  it('decodes decimal and hexadecimal numeric references', () => {
    expect(decodeXmlEntities('&#66;&#x69;r')).toBe('Bir')
    expect(decodeXmlEntities('&#128512;')).toBe('\u{1F600}')
  })

  it('leaves DTD-defined and malformed entities untouched', () => {
    // `processEntities: false` means custom DOCTYPE entities were never
    // expanded — we must not start expanding them here either.
    expect(decodeXmlEntities('&customEntity;')).toBe('&customEntity;')
    expect(decodeXmlEntities('&#x110000;')).toBe('&#x110000;')
    expect(decodeXmlEntities('100% & rising')).toBe('100% & rising')
  })

  it('returns the input untouched when there is nothing to decode', () => {
    expect(decodeXmlEntities('Haberler')).toBe('Haberler')
  })
})

describe('parseEPGXml prototype pollution protection', () => {
  const now = new Date()
  // Build a start time in XMLTV format inside our +/- window
  const pad = (n: number) => String(n).padStart(2, '0')
  const startStr =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00 +0000`
  const end = new Date(now.getTime() + 60 * 60 * 1000)
  const endStr =
    `${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}` +
    `${pad(end.getUTCHours())}${pad(end.getUTCMinutes())}00 +0000`

  it('ignores __proto__ channel ids instead of polluting Object prototype', () => {
    const xml = `<?xml version="1.0"?>
<tv>
  <channel id="__proto__"><display-name>Evil</display-name></channel>
  <channel id="real"><display-name>Real Channel</display-name></channel>
  <programme channel="__proto__" start="${startStr}" stop="${endStr}">
    <title>Pwned</title>
  </programme>
  <programme channel="real" start="${startStr}" stop="${endStr}">
    <title>Normal</title>
  </programme>
</tv>`

    const data = parseEPGXml(xml)

    // Prototype wasn't touched.
    expect(({} as Record<string, unknown>)['pwned']).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('Pwned')

    // Unsafe key wasn't added to the channels map.
    expect(Object.keys(data.channels)).not.toContain('__proto__')
    expect(Object.keys(data.programs)).not.toContain('__proto__')

    // Real channel still parsed.
    expect(data.channels['real']).toEqual(
      expect.objectContaining({ id: 'real', displayName: 'Real Channel' })
    )
    expect(data.programs['real']).toHaveLength(1)
  })

  it('decodes entities in programme and channel text', () => {
    const xml = `<?xml version="1.0"?>
<tv>
  <channel id="kanal"><display-name>Kanal &amp; Co</display-name></channel>
  <programme channel="kanal" start="${startStr}" stop="${endStr}">
    <title>Tom &amp; Jerry &quot;Ozel&quot;</title>
    <desc>Bir &lt;b&gt;klasik&lt;/b&gt;</desc>
    <category>Cizgi &amp; Animasyon</category>
  </programme>
</tv>`

    const data = parseEPGXml(xml)

    expect(data.channels['kanal']?.displayName).toBe('Kanal & Co')
    expect(data.programs['kanal']?.[0]).toEqual(
      expect.objectContaining({
        title: 'Tom & Jerry "Ozel"',
        description: 'Bir <b>klasik</b>',
        category: 'Cizgi & Animasyon'
      })
    )
  })

  it('uses null-prototype maps so property lookups never fall back to Object.prototype', () => {
    const xml = `<?xml version="1.0"?><tv><channel id="x"><display-name>X</display-name></channel></tv>`
    const data = parseEPGXml(xml)
    expect(Object.getPrototypeOf(data.channels)).toBeNull()
    expect(Object.getPrototypeOf(data.programs)).toBeNull()
  })

  it('picks the Turkish title and description from multi-language programmes', () => {
    // Repeated <title lang> elements arrive as an array and used to become "Başlık Yok".
    const xml = `<?xml version="1.0"?>
<tv>
  <channel id="kanal">
    <display-name lang="en">Channel One</display-name>
    <display-name lang="tr">Kanal Bir</display-name>
  </channel>
  <programme channel="kanal" start="${startStr}" stop="${endStr}">
    <title lang="en">Evening News</title>
    <title lang="tr">Akşam Haberleri</title>
    <desc lang="en">Daily news.</desc>
    <desc lang="tr">Günün haberleri.</desc>
    <category lang="en">News</category>
    <category lang="tr">Haber</category>
  </programme>
</tv>`

    const data = parseEPGXml(xml)

    expect(data.channels['kanal']?.displayName).toBe('Kanal Bir')
    expect(data.programs['kanal']?.[0]).toEqual(
      expect.objectContaining({
        title: 'Akşam Haberleri',
        description: 'Günün haberleri.',
        category: 'Haber',
        lang: 'tr'
      })
    )
  })

  it('falls back to the first available language when there is no Turkish text', () => {
    const xml = `<?xml version="1.0"?>
<tv>
  <programme channel="kanal" start="${startStr}" stop="${endStr}">
    <title lang="de">Nachrichten</title>
    <title lang="en">News</title>
  </programme>
</tv>`

    expect(parseEPGXml(xml).programs['kanal']?.[0]?.title).toBe('Nachrichten')
  })

  it('keeps numeric-looking titles exactly as written', () => {
    const xml = `<?xml version="1.0"?>
<tv>
  <programme channel="kanal" start="${startStr}" stop="${endStr}"><title>007</title></programme>
</tv>`

    expect(parseEPGXml(xml).programs['kanal']?.[0]?.title).toBe('007')
  })
})

describe('pickLocalizedText', () => {
  it('matches three-letter and regional language codes', () => {
    expect(
      pickLocalizedText([
        { '#text': 'News', '@_lang': 'eng' },
        { '#text': 'Haberler', '@_lang': 'tur' }
      ])
    ).toEqual({ text: 'Haberler', lang: 'tur' })
    expect(pickLocalizedText([{ '#text': 'A', '@_lang': 'en' }, { '#text': 'B', '@_lang': 'tr-TR' }])?.text).toBe('B')
  })

  it('handles a plain string, an object without lang and empty values', () => {
    expect(pickLocalizedText('Haber')).toEqual({ text: 'Haber', lang: '' })
    expect(pickLocalizedText({ '#text': 'Spor' })).toEqual({ text: 'Spor', lang: '' })
    expect(pickLocalizedText([{ '#text': '  ', '@_lang': 'tr' }, 'Yedek'])).toEqual({ text: 'Yedek', lang: '' })
    expect(pickLocalizedText(undefined)).toBeUndefined()
    expect(pickLocalizedText([])).toBeUndefined()
  })
})


const pad = (n: number) => String(n).padStart(2, '0')
const xmltvTime = (ms: number) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`
}
const HOUR = 3600_000
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0)
const WINDOW = { windowStart: NOW - 2 * HOUR, windowEnd: NOW + 24 * HOUR }
const programme = (channel: string, startMs: number, title: string) =>
  `<programme channel="${channel}" start="${xmltvTime(startMs)}" stop="${xmltvTime(startMs + HOUR)}"><title lang="tr">${title}</title></programme>`

function streamOf(parts: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= parts.length) {
        controller.close()
        return
      }
      const part = parts[index++]
      controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part)
    }
  })
}

describe('streaming XMLTV parser', () => {
  const doc = `<?xml version="1.0"?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv>
  <channel id="Kanal.TR"><display-name lang="en">Channel</display-name><display-name lang="tr">Kanal &amp; Bir</display-name><icon src="http://img/k.png"/></channel>
  <!-- a comment with <programme> inside -->
  ${programme('kanal.tr', NOW - HOUR, 'Önce')}
  ${programme('kanal.tr', NOW, 'Şimdi &lt;canlı&gt;')}
  <programme channel="kanal.tr" start="${xmltvTime(NOW + HOUR)}" stop="${xmltvTime(NOW + 2 * HOUR)}"><title><![CDATA[Tom & Jerry <özel>]]></title><desc lang="tr">Açıklama</desc></programme>
</tv>`

  it('gives the same guide however the text is split', () => {
    const whole = createXmltvParser(WINDOW)
    whole.feed(doc)
    const expected = whole.end()

    for (const size of [1, 2, 7, 64]) {
      const parser = createXmltvParser(WINDOW)
      for (let i = 0; i < doc.length; i += size) parser.feed(doc.slice(i, i + size))
      const result = parser.end()
      expect(result).toEqual(expected)
    }
    expect(expected.truncated).toBeNull()
    expect(expected.channels['kanal.tr']).toEqual({ id: 'Kanal.TR', displayName: 'Kanal & Bir', icon: 'http://img/k.png' })
    expect(expected.programs['kanal.tr']?.map((p) => p.title)).toEqual(['Önce', 'Şimdi <canlı>', 'Tom & Jerry <özel>'])
    expect(expected.programs['kanal.tr']?.[2]?.description).toBe('Açıklama')
  })

  it('drops programmes outside the time window while parsing', () => {
    const parser = createXmltvParser(WINDOW)
    parser.feed(`<tv>${programme('a', NOW - 5 * HOUR, 'Eski')}${programme('a', NOW, 'Şimdi')}${programme('a', NOW + 30 * HOUR, 'Uzak')}</tv>`)
    expect(parser.end().programs['a']?.map((p) => p.title)).toEqual(['Şimdi'])
  })

  it('keeps only the channels asked for', () => {
    const parser = createXmltvParser({ ...WINDOW, channelKeys: new Set(['b']) })
    parser.feed(`<tv><channel id="a"><display-name>A</display-name></channel><channel id="B"><display-name>B</display-name></channel>${programme('a', NOW, 'x')}${programme('B', NOW, 'y')}</tv>`)
    const result = parser.end()
    expect(Object.keys(result.channels)).toEqual(['b'])
    expect(Object.keys(result.programs)).toEqual(['b'])
  })

  it('never expands DOCTYPE entities', () => {
    const parser = createXmltvParser(WINDOW)
    parser.feed(`<!DOCTYPE tv [<!ENTITY boom "PATLADI"><!ENTITY big "&boom;&boom;&boom;">]><tv>${programme('a', NOW, '&big; &amp;')}</tv>`)
    expect(parser.end().programs['a']?.[0]?.title).toBe('&big; &')
  })

  it('survives malformed markup and keeps what is well formed after it', () => {
    const broken = `<tv><programme channel="a" start="${xmltvTime(NOW)}" stop="x><title>yarım` + ' kayıp'.repeat(400_000) + `</tv>`
    const parser = createXmltvParser(WINDOW)
    for (let i = 0; i < broken.length; i += 65_536) parser.feed(broken.slice(i, i + 65_536))
    parser.feed(`<tv>${programme('b', NOW, 'Sağlam')}</tv>`)
    expect(() => parser.end()).not.toThrow()

    const garbage = createXmltvParser(WINDOW)
    garbage.feed('<<<>>> &&& </nope> <tv attr=>< /tv>')
    expect(garbage.end().programs).toEqual({})
  })

  it('reports a document cut off mid-programme and keeps the complete ones', () => {
    const parser = createXmltvParser(WINDOW)
    parser.feed(`<tv>${programme('a', NOW, 'Bir')}${programme('a', NOW + HOUR, 'İki')}<programme channel="a" start="${xmltvTime(NOW + 2 * HOUR)}"><title>Ya`)
    const result = parser.end()
    expect(result.truncated).toBe('cut-off')
    expect(result.programs['a']?.map((p) => p.title)).toEqual(['Bir', 'İki'])
  })

  it('reports a guide with more channels than are kept', () => {
    const parser = createXmltvParser({ ...WINDOW, maxChannels: 2 })
    parser.feed(`<tv>${programme('a', NOW, '1')}${programme('b', NOW, '2')}${programme('c', NOW, '3')}</tv>`)
    const result = parser.end()
    expect(result.truncated).toBe('limit')
    expect(Object.keys(result.programs)).toEqual(['a', 'b'])
  })

  it('parses a guide far past the old 50 MB cut-off in full, without holding the text', async () => {
    // 60 MB of programmes outside the window, then one inside it at the very end.
    const old = programme('eski', NOW - 48 * HOUR, 'Geçmiş') + '\n'
    const block = new TextEncoder().encode(old.repeat(Math.ceil((4 * 1024 * 1024) / old.length)))
    const parts: Array<string | Uint8Array> = ['<?xml version="1.0"?><tv>']
    for (let sent = 0; sent < 60 * 1024 * 1024; sent += block.length) parts.push(block)
    parts.push(programme('son', NOW, 'Sonda'), '</tv>')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(streamOf(parts), { status: 200 }))))

    const data = await fetchAndParseEPG('https://epg.example/xmltv.php', { window: WINDOW })

    expect(data.truncated).toBeUndefined()
    expect(data.programs['son']?.map((p) => p.title)).toEqual(['Sonda'])
    expect(data.programs['eski']).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('marks a download that ends mid-document as incomplete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(streamOf([`<tv>${programme('kanal', NOW, 'Program')}<programme channel="kanal"><title>`]), { status: 200 })))
    )
    const data = await fetchAndParseEPG('https://epg.example/xmltv.php', { window: WINDOW })
    expect(data.truncated).toBe(true)
    expect(data.truncatedReason).toBe('cut-off')
    expect(data.programs['kanal']).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  it('does not mark a complete download as truncated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<?xml version="1.0"?><tv></tv>', { status: 200 })))
    )
    const data = await fetchAndParseEPG('https://epg.example/xmltv.php')
    expect(data.truncated).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('carries the host on a failed download', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchAndParseEPG('https://Epg.Example:8443/xmltv.php')).rejects.toMatchObject({ kind: 'network', host: 'epg.example' })
    vi.unstubAllGlobals()
  })
})
