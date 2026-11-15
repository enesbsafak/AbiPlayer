import { describe, expect, it, vi } from 'vitest'
import {
  closeTruncatedXmltv,
  decodeXmlEntities,
  fetchAndParseEPG,
  normalizeEpgChannelKey,
  parseEPGXml,
  pickLocalizedText
} from './epg-service'

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

    expect(data.channels['kanal'].displayName).toBe('Kanal & Co')
    expect(data.programs['kanal'][0]).toEqual(
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

    expect(data.channels['kanal'].displayName).toBe('Kanal Bir')
    expect(data.programs['kanal'][0]).toEqual(
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

    expect(parseEPGXml(xml).programs['kanal'][0].title).toBe('Nachrichten')
  })

  it('keeps numeric-looking titles exactly as written', () => {
    const xml = `<?xml version="1.0"?>
<tv>
  <programme channel="kanal" start="${startStr}" stop="${endStr}"><title>007</title></programme>
</tv>`

    expect(parseEPGXml(xml).programs['kanal'][0].title).toBe('007')
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

describe('truncated XMLTV', () => {
  it('closes a document cut off mid-programme at the last complete element', () => {
    const cut = `<?xml version="1.0"?><tv><channel id="a"><display-name>A</display-name></channel><programme channel="a" start="1" stop="2"><title>Bir</title></programme><programme channel="a" start="2" stop="3"><title>Ya`
    expect(closeTruncatedXmltv(cut)).toBe(
      `<?xml version="1.0"?><tv><channel id="a"><display-name>A</display-name></channel><programme channel="a" start="1" stop="2"><title>Bir</title></programme>\n</tv>`
    )
    expect(closeTruncatedXmltv('<tv><channel id="a"><display-name>A</display-name></channel><chan')).toBe(
      '<tv><channel id="a"><display-name>A</display-name></channel>\n</tv>'
    )
    expect(closeTruncatedXmltv('<tv><chan')).toBe('<tv></tv>')
  })

  it('marks a download that hit the size limit as truncated', async () => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (d: Date) =>
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`
    const start = fmt(now)
    const stop = fmt(new Date(now.getTime() + 3600_000))
    const programme = `<programme channel="kanal" start="${start}" stop="${stop}"><title>Program</title></programme>\n`
    const encoder = new TextEncoder()
    // closeTruncatedXmltv drops everything after the last complete programme, so
    // only the programmes before the cut are ever parsed. The rest of the 50 MB
    // limit is filled with an unfinished programme: the size-limit path is
    // exercised without the test's CPU time (and its timeout) depending on load.
    const head = encoder.encode(
      `<?xml version="1.0"?>\n<tv>\n${programme.repeat(50)}<programme channel="kanal"><title>`
    )
    const block = new Uint8Array(4 * 1024 * 1024).fill(0x78)
    const limit = 50 * 1024 * 1024
    let sent = 0
    let headSent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!headSent) {
          headSent = true
          controller.enqueue(head)
          return
        }
        if (sent > limit + block.length) {
          // The server never gets to send </tv>: the reader cancels first.
          controller.close()
          return
        }
        controller.enqueue(block)
        sent += block.length
      }
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))))

    const data = await fetchAndParseEPG('https://epg.example/xmltv.php')

    expect(data.truncated).toBe(true)
    expect(data.programs['kanal'].length).toBeGreaterThan(0)
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
})
