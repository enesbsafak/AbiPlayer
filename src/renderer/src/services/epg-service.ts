import { XMLParser } from 'fast-xml-parser'
import type { EPGData, EPGProgram, EPGChannel } from '@/types/epg'

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
    const tzStr = tzMatch[1]
    const tzHours = parseInt(tzStr.substring(0, 3))
    const tzMinutes = parseInt(tzStr[0] + tzStr.substring(3))
    offsetMs = (tzHours * 60 + tzMinutes) * 60 * 1000
  }

  const utc = Date.UTC(year, month, day, hour, minute, second)
  return utc - offsetMs
}

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

// Only keep programs within a time window to save memory
const EPG_WINDOW_HOURS_BEFORE = 2
const EPG_WINDOW_HOURS_AFTER = 24
const MAX_CHANNELS = 2000
const MAX_PROGRAMS_PER_CHANNEL = 100

export async function fetchAndParseEPG(url: string): Promise<EPGData> {
  const controller = new AbortController()
  // 60 second timeout for large EPG files
  const timeout = setTimeout(() => controller.abort(), 60000)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`EPG indirilemedi: ${res.status}`)

    // Read as text - for very large files, limit to ~50MB
    const reader = res.body?.getReader()
    if (!reader) throw new Error('Sunucudan gecerli veri gelmedi')

    const chunks: Uint8Array[] = []
    let totalSize = 0
    const MAX_SIZE = 50 * 1024 * 1024 // 50MB limit

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalSize += value.length
      if (totalSize > MAX_SIZE) {
        reader.cancel()
        break
      }
    }

    const decoder = new TextDecoder()
    let xml = ''
    for (const chunk of chunks) {
      xml += decoder.decode(chunk, { stream: true })
    }
    xml += decoder.decode()

    // Free chunks
    chunks.length = 0

    return parseEPGXml(xml)
  } finally {
    clearTimeout(timeout)
  }
}

export function parseEPGXml(xml: string): EPGData {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['channel', 'programme', 'display-name'].includes(name)
  })

  const parsed = parser.parse(xml)
  const tv = parsed.tv || parsed.TV || {}

  const channels: Record<string, EPGChannel> = {}
  const programs: Record<string, EPGProgram[]> = {}

  // Time window for filtering
  const now = Date.now()
  const windowStart = now - EPG_WINDOW_HOURS_BEFORE * 3600000
  const windowEnd = now + EPG_WINDOW_HOURS_AFTER * 3600000

  // Parse channels (limited)
  const xmlChannels = ensureArray(tv.channel).slice(0, MAX_CHANNELS)
  for (const ch of xmlChannels) {
    const id = ch['@_id']
    if (!id) continue
    const displayNames = ensureArray(ch['display-name'])
    const displayName = typeof displayNames[0] === 'object' ? displayNames[0]['#text'] : displayNames[0]
    channels[id] = {
      id,
      displayName: displayName || id,
      icon: ch.icon?.['@_src']
    }
  }

  // Parse programmes - only within time window
  const xmlProgs = ensureArray(tv.programme)
  for (const prog of xmlProgs) {
    const channelId = prog['@_channel']
    if (!channelId) continue

    const start = parseXMLTVDate(prog['@_start'] || '')
    const end = parseXMLTVDate(prog['@_stop'] || '')

    // Skip programs outside our window
    if (end < windowStart || start > windowEnd) continue

    const title = typeof prog.title === 'object' ? prog.title['#text'] : prog.title
    const desc = typeof prog.desc === 'object' ? prog.desc?.['#text'] : prog.desc
    const catVal = typeof prog.category === 'object' ? prog.category?.['#text'] : prog.category

    if (!programs[channelId]) programs[channelId] = []

    // Limit per channel
    if (programs[channelId].length >= MAX_PROGRAMS_PER_CHANNEL) continue

    programs[channelId].push({
      channelId,
      title: title || 'Baslik Yok',
      description: desc || undefined,
      start,
      end,
      category: catVal || undefined,
      icon: prog.icon?.['@_src']
    })
  }

  // Sort programs by start time
  for (const channelId of Object.keys(programs)) {
    programs[channelId].sort((a, b) => a.start - b.start)
  }

  return { channels, programs, lastUpdated: Date.now() }
}

export function findCurrentProgram(programs: EPGProgram[], now?: number): EPGProgram | null {
  const timestamp = now ?? Date.now()
  if (!programs || programs.length === 0) return null

  let low = 0
  let high = programs.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const prog = programs[mid]
    if (timestamp >= prog.start && timestamp < prog.end) return prog
    if (timestamp < prog.start) high = mid - 1
    else low = mid + 1
  }

  return null
}

export function getUpcomingPrograms(programs: EPGProgram[], count = 5, now?: number): EPGProgram[] {
  const timestamp = now ?? Date.now()
  if (!programs) return []
  const idx = programs.findIndex((p) => p.end > timestamp)
  if (idx === -1) return []
  return programs.slice(idx, idx + count)
}
