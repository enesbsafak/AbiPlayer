import { itemAt } from '../../../shared/checked'
import type { EPGData, EPGProgram, EPGChannel, EPGTruncation } from '@/types/epg'
import { streamText } from './m3u-parser'
import {
  MAX_DESCRIPTION_CHARS,
  MAX_EPG_CHANNELS,
  MAX_PROGRAMMES_PER_CHANNEL,
  PREFERRED_EPG_LANGUAGES,
  decodeXmlEntities,
  epgWindow,
  normalizeEpgChannelKey,
  pickPreferred,
  type LocalizedText
} from './epg-service'

/*
 * XMLTV, parsed as it streams in.
 *
 * The guide used to be read into one string (cut at 50 MB), parsed into a
 * full object tree and only then filtered. Now a small tokenizer walks the
 * text piece by piece as the download delivers it and keeps only what the
 * guide page shows: channels, and programmes inside the time window. Nothing
 * here touches the DOM, so it runs in the catalog worker.
 *
 * Hardening kept from the earlier tree parser: no DOCTYPE entity is ever
 * expanded (only the five predefined entities and numeric references are
 * decoded), and untrusted ids never become keys of an ordinary object.
 */

function parseXMLTVDate(str: string): number {
  if (!str) return 0
  const cleaned = str.replace(/\s+/g, '')
  const year = parseInt(cleaned.substring(0, 4))
  const month = parseInt(cleaned.substring(4, 6)) - 1
  const day = parseInt(cleaned.substring(6, 8))
  const hour = parseInt(cleaned.substring(8, 10))
  const minute = parseInt(cleaned.substring(10, 12))
  const second = parseInt(cleaned.substring(12, 14)) || 0

  const tzMatch = cleaned.match(/([+-]\d{4})$/)
  let offsetMs = 0
  if (tzMatch) {
    const tzStr = itemAt(tzMatch, 1)
    const tzHours = parseInt(tzStr.substring(0, 3))
    const tzMinutes = parseInt(tzStr.charAt(0) + tzStr.substring(3))
    offsetMs = (tzHours * 60 + tzMinutes) * 60 * 1000
  }

  const utc = Date.UTC(year, month, day, hour, minute, second)
  return utc - offsetMs
}

export interface XmltvParseOptions {
  windowStart: number
  windowEnd: number
  /** Normalized channel keys to keep; null or absent keeps every channel (up to the limit). */
  channelKeys?: ReadonlySet<string> | null
  maxChannels?: number
  maxProgrammesPerChannel?: number
  preferredLanguages?: readonly string[]
}

export interface XmltvResult {
  channels: Record<string, EPGChannel>
  programs: Record<string, EPGProgram[]>
  truncated: EPGTruncation | null
}

type Attributes = Map<string, string>

interface PendingChannel {
  id: string
  names: LocalizedText[]
  icon?: string
}

interface PendingProgramme {
  key: string
  start: number
  end: number
  titles: LocalizedText[]
  descs: LocalizedText[]
  categories: LocalizedText[]
  icon?: string
}

/** Text being collected for one element (title, desc, category, display-name). */
interface Capture {
  name: string
  lang: string
  parts: string[]
  length: number
}

function isNameChar(code: number): boolean {
  // Anything but whitespace, '/', '>' and '='.
  return code > 32 && code !== 47 && code !== 62 && code !== 61
}

/** Parses the attributes of a start tag body (`name a="1" b='2'`), entities decoded. */
function parseAttributes(body: string, from: number): Attributes {
  const attributes: Attributes = new Map()
  let i = from
  const length = body.length
  while (i < length) {
    while (i < length && body.charCodeAt(i) <= 32) i++
    const nameStart = i
    while (i < length && isNameChar(body.charCodeAt(i))) i++
    if (i === nameStart) {
      i++
      continue
    }
    const name = body.slice(nameStart, i)
    while (i < length && body.charCodeAt(i) <= 32) i++
    if (body[i] !== '=') {
      attributes.set(name, '')
      continue
    }
    i++
    while (i < length && body.charCodeAt(i) <= 32) i++
    const quote = body[i]
    if (quote === '"' || quote === "'") {
      const close = body.indexOf(quote, i + 1)
      const end = close === -1 ? length : close
      attributes.set(name, decodeXmlEntities(body.slice(i + 1, end)))
      i = end + 1
    } else {
      const valueStart = i
      while (i < length && body.charCodeAt(i) > 32) i++
      attributes.set(name, decodeXmlEntities(body.slice(valueStart, i)))
    }
  }
  return attributes
}

/** Index of the `>` that closes the tag starting at `from` (quotes respected), or -1. */
function findTagEnd(text: string, from: number): number {
  let quote = 0
  for (let i = from; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (quote) {
      if (code === quote) quote = 0
    } else if (code === 34 || code === 39) {
      quote = code
    } else if (code === 62) {
      return i
    }
  }
  return -1
}

/** End of a `<!DOCTYPE ...>` declaration, internal subset included, or -1. */
function findDeclarationEnd(text: string, from: number): number {
  let depth = 0
  let quote = 0
  for (let i = from; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (quote) {
      if (code === quote) quote = 0
    } else if (code === 34 || code === 39) {
      quote = code
    } else if (code === 91) {
      depth++
    } else if (code === 93) {
      depth = Math.max(0, depth - 1)
    } else if (code === 62 && depth === 0) {
      return i
    }
  }
  return -1
}

const CAPTURED_IN_CHANNEL = new Set(['display-name'])
/** Longest unfinished construct (tag, comment, CDATA) or text run held while waiting for more input. */
const MAX_PENDING_CHARS = 1 << 20
/** Text collected per element beyond this is dropped. */
const MAX_CAPTURE_CHARS = 16_384
const CAPTURED_IN_PROGRAMME = new Set(['title', 'desc', 'category'])

/**
 * Incremental XMLTV parser. `feed` takes decoded text in pieces of any size;
 * `end` returns the windowed guide. Lenient: malformed markup is skipped, an
 * unfinished document keeps everything complete before the cut and reports
 * `truncated: 'cut-off'`. Never throws on bad input.
 */
export function createXmltvParser(options: XmltvParseOptions): { feed(text: string): void; end(): XmltvResult } {
  const maxChannels = options.maxChannels ?? MAX_EPG_CHANNELS
  const maxProgrammes = options.maxProgrammesPerChannel ?? MAX_PROGRAMMES_PER_CHANNEL
  const preferred = options.preferredLanguages ?? PREFERRED_EPG_LANGUAGES
  const wanted = options.channelKeys && options.channelKeys.size > 0 ? options.channelKeys : null

  // Null-prototype maps: a hostile id can never reach Object.prototype.
  const channels = Object.create(null) as Record<string, EPGChannel>
  const programs = Object.create(null) as Record<string, EPGProgram[]>
  let channelCount = 0
  let programmeChannelCount = 0
  let truncated: EPGTruncation | null = null

  let buffer = ''
  let pos = 0
  /** Open elements, by name. */
  const stack: string[] = []
  let rootIsTv = false
  let rootClosed = false
  let channel: PendingChannel | null = null
  let programme: PendingProgramme | null = null
  /** Depth at which the skipped programme started; its whole content is ignored. */
  let skipDepth = -1
  let capture: Capture | null = null

  const acceptsChannel = (key: string): boolean => {
    if (wanted && !wanted.has(key)) return false
    return true
  }

  const finishChannel = (pending: PendingChannel) => {
    const key = normalizeEpgChannelKey(pending.id)
    if (!key || !acceptsChannel(key) || channels[key]) return
    if (channelCount >= maxChannels) {
      truncated = 'limit'
      return
    }
    channelCount++
    channels[key] = { id: pending.id, displayName: pickPreferred(pending.names, preferred)?.text || pending.id, ...(pending.icon ? { icon: pending.icon } : {}) }
  }

  const finishProgramme = (pending: PendingProgramme) => {
    let list = programs[pending.key]
    if (!list) {
      if (programmeChannelCount >= maxChannels) {
        truncated = 'limit'
        return
      }
      programmeChannelCount++
      list = []
      programs[pending.key] = list
    }
    if (list.length >= maxProgrammes) {
      truncated = 'limit'
      return
    }
    const title = pickPreferred(pending.titles, preferred)
    const desc = pickPreferred(pending.descs, preferred)
    const category = pickPreferred(pending.categories, preferred)
    const program: EPGProgram = {
      channelId: pending.key,
      title: title?.text || 'Başlık Yok',
      start: pending.start,
      end: pending.end
    }
    if (desc?.text) program.description = desc.text.length > MAX_DESCRIPTION_CHARS ? `${desc.text.slice(0, MAX_DESCRIPTION_CHARS)}…` : desc.text
    if (category?.text) program.category = category.text
    if (pending.icon) program.icon = pending.icon
    if (title?.lang) program.lang = title.lang
    list.push(program)
  }

  const startElement = (name: string, attributes: Attributes, selfClosing: boolean) => {
    const depth = stack.length + 1 // depth of this element: root is 1
    if (!selfClosing) stack.push(name)
    if (skipDepth !== -1) {
      if (selfClosing && depth === skipDepth) skipDepth = -1
      return
    }
    if (depth === 1) {
      rootIsTv = name.toLowerCase() === 'tv'
      return
    }
    if (!rootIsTv) return

    if (depth === 2) {
      if (name === 'channel') {
        const id = attributes.get('id') ?? ''
        if (!id) {
          if (!selfClosing) skipDepth = depth
          return
        }
        channel = { id, names: [] }
        if (selfClosing) {
          finishChannel(channel)
          channel = null
        }
      } else if (name === 'programme') {
        const key = normalizeEpgChannelKey(attributes.get('channel') ?? '')
        const start = parseXMLTVDate(attributes.get('start') ?? '')
        const end = parseXMLTVDate(attributes.get('stop') ?? '')
        // Outside the window, or not one of ours: dropped while parsing.
        if (!key || !acceptsChannel(key) || end < options.windowStart || start > options.windowEnd) {
          if (!selfClosing) skipDepth = depth
          return
        }
        programme = { key, start, end, titles: [], descs: [], categories: [] }
        if (selfClosing) {
          finishProgramme(programme)
          programme = null
        }
      } else if (!selfClosing) {
        skipDepth = depth
      }
      return
    }

    if (depth === 3) {
      const lang = attributes.get('lang') ?? ''
      if (channel) {
        if (name === 'icon') {
          const src = attributes.get('src')
          if (src && !channel.icon) channel.icon = src
        } else if (CAPTURED_IN_CHANNEL.has(name) && !selfClosing) {
          capture = { name, lang, parts: [], length: 0 }
        }
      } else if (programme) {
        if (name === 'icon') {
          const src = attributes.get('src')
          if (src && !programme.icon) programme.icon = src
        } else if (CAPTURED_IN_PROGRAMME.has(name) && !selfClosing) {
          capture = { name, lang, parts: [], length: 0 }
        }
      }
    }
  }

  const endElement = (name: string) => {
    // Tolerate mismatched end tags: close up to the matching open element.
    let index = stack.length - 1
    while (index >= 0 && stack[index] !== name) index--
    if (index < 0) return
    const depth = index + 1
    stack.length = index

    if (skipDepth !== -1) {
      if (depth <= skipDepth) skipDepth = -1
      return
    }
    if (depth === 1) {
      if (rootIsTv) rootClosed = true
      return
    }
    if (depth === 3 && capture && capture.name === name) {
      const text = capture.parts.join('').trim()
      if (text) {
        const entry = { text, lang: capture.lang }
        if (channel && name === 'display-name') channel.names.push(entry)
        else if (programme && name === 'title') programme.titles.push(entry)
        else if (programme && name === 'desc') programme.descs.push(entry)
        else if (programme && name === 'category') programme.categories.push(entry)
      }
      capture = null
      return
    }
    if (depth <= 2) {
      capture = null
      if (channel) finishChannel(channel)
      if (programme) finishProgramme(programme)
      channel = null
      programme = null
    }
  }

  const appendText = (raw: string) => {
    if (!capture || skipDepth !== -1 || capture.length > MAX_CAPTURE_CHARS) return
    capture.length += raw.length
    capture.parts.push(decodeXmlEntities(raw))
  }

  const run = (final: boolean) => {
    const text = buffer
    for (;;) {
      const open = text.indexOf('<', pos)
      if (open === -1) {
        // Text after the last tag is consumed once its end is known, so an
        // entity is never split; a very long run is consumed up to its last
        // '&' so the buffer cannot grow without bound.
        if (final) {
          appendText(text.slice(pos))
          pos = text.length
        } else if (text.length - pos > MAX_PENDING_CHARS) {
          const amp = text.lastIndexOf('&')
          const cut = amp > pos && text.length - amp < 16 ? amp : text.length
          appendText(text.slice(pos, cut))
          pos = cut
        }
        break
      }
      if (open > pos) appendText(text.slice(pos, open))
      pos = open

      if (text.startsWith('<!--', open)) {
        const close = text.indexOf('-->', open + 4)
        if (close === -1) {
          if (stuck(text, open)) continue
          break
        }
        pos = close + 3
      } else if (text.startsWith('<![CDATA[', open)) {
        const close = text.indexOf(']]>', open + 9)
        if (close === -1) {
          if (stuck(text, open)) continue
          break
        }
        // CDATA is literal text: no entity decoding.
        if (capture && skipDepth === -1 && capture.length <= MAX_CAPTURE_CHARS) {
          capture.length += close - open - 9
          capture.parts.push(text.slice(open + 9, close))
        }
        pos = close + 3
      } else if (text.startsWith('<?', open)) {
        const close = text.indexOf('?>', open + 2)
        if (close === -1) {
          if (stuck(text, open)) continue
          break
        }
        pos = close + 2
      } else if (text.startsWith('<!', open)) {
        // DOCTYPE and other declarations are skipped whole; their entities
        // are never defined, let alone expanded.
        const close = findDeclarationEnd(text, open + 2)
        if (close === -1) {
          if (stuck(text, open)) continue
          break
        }
        pos = close + 1
      } else if (text.startsWith('</', open)) {
        const close = text.indexOf('>', open + 2)
        if (close === -1) {
          if (stuck(text, open)) continue
          break
        }
        endElement(text.slice(open + 2, close).trim())
        pos = close + 1
      } else {
        const close = findTagEnd(text, open + 1)
        if (close === -1) {
          if (stuck(text, open)) continue
          break
        }
        const selfClosing = text.charCodeAt(close - 1) === 47
        const body = text.slice(open + 1, selfClosing ? close - 1 : close)
        let nameEnd = 0
        while (nameEnd < body.length && isNameChar(body.charCodeAt(nameEnd))) nameEnd++
        const name = body.slice(0, nameEnd)
        if (name) {
          // Attributes are read only where they matter.
          const needsAttributes = skipDepth === -1 && stack.length <= 2
          startElement(name, needsAttributes ? parseAttributes(body, nameEnd) : new Map(), selfClosing)
        }
        pos = close + 1
      }
    }
    // Keep only the unprocessed tail.
    if (pos > 0) {
      buffer = text.slice(pos)
      pos = 0
    }
  }

  /**
   * A construct that has not closed after MAX_PENDING_CHARS is malformed (an
   * unclosed quote or comment): its '<' is skipped as text, so one broken tag
   * can neither hold the whole rest of the document in memory nor make every
   * later piece rescan it.
   */
  function stuck(text: string, open: number): boolean {
    if (text.length - open <= MAX_PENDING_CHARS) return false
    pos = open + 1
    return true
  }

  return {
    feed(text) {
      buffer = buffer ? buffer + text : text
      run(false)
    },
    end() {
      run(true)
      // Cut mid-document: what was complete is kept, the rest is reported.
      if (rootIsTv && !rootClosed) truncated = 'cut-off'
      buffer = ''
      for (const list of Object.values(programs)) list.sort((a, b) => a.start - b.start)
      return { channels, programs, truncated }
    }
  }
}

function toEpgData(result: XmltvResult): EPGData {
  const data: EPGData = { channels: result.channels, programs: result.programs, lastUpdated: Date.now() }
  if (result.truncated) {
    data.truncated = true
    data.truncatedReason = result.truncated
  }
  return data
}

/** Parses a whole XMLTV document (tests, small inputs), keeping the default window around now. */
export function parseEPGXml(xml: string, options?: Partial<XmltvParseOptions>): EPGData {
  const parser = createXmltvParser({ ...epgWindow(), ...options })
  parser.feed(xml)
  return toEpgData(parser.end())
}

/**
 * Downloads and parses a guide in this thread, streamed: no whole-document
 * string and no size limit. The catalog worker's EPG job runs this.
 */
export async function fetchAndParseEPG(
  url: string,
  options: { signal?: AbortSignal; channelKeys?: ReadonlySet<string> | null; window?: { windowStart: number; windowEnd: number }; onProgress?: (bytes: number) => void } = {}
): Promise<EPGData> {
  const parser = createXmltvParser({ ...(options.window ?? epgWindow()), channelKeys: options.channelKeys ?? null })
  await streamText(url, (text) => parser.feed(text), {
    signal: options.signal,
    onProgress: options.onProgress,
    httpMessage: (status) => `EPG indirilemedi: ${status}`,
    timeoutMessage: 'EPG indirilirken zaman aşımı oluştu'
  })
  return toEpgData(parser.end())
}
