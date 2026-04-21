import { describe, expect, it } from 'vitest'
import { normalizeEpgChannelKey, parseEPGXml } from './epg-service'

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

  it('uses null-prototype maps so property lookups never fall back to Object.prototype', () => {
    const xml = `<?xml version="1.0"?><tv><channel id="x"><display-name>X</display-name></channel></tv>`
    const data = parseEPGXml(xml)
    expect(Object.getPrototypeOf(data.channels)).toBeNull()
    expect(Object.getPrototypeOf(data.programs)).toBeNull()
  })
})
