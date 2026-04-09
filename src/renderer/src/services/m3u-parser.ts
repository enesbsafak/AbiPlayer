import type { Channel, Category } from '@/types/playlist'

interface M3UEntry {
  name: string
  logo: string
  group: string
  tvgId: string
  tvgName: string
  url: string
}

const M3U_FETCH_TIMEOUT_MS = 120_000
const MAX_M3U_SIZE_BYTES = 20 * 1024 * 1024
const VOD_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv'])

function extractAttribute(line: string, attr: string): string {
  // Try quoted first: tvg-id="value"
  const quotedRe = new RegExp(`${attr}="([^"]*)"`)
  const quotedMatch = line.match(quotedRe)
  if (quotedMatch) return quotedMatch[1]

  // Try unquoted: tvg-id=value (terminated by space or end of line before comma)
  const unquotedRe = new RegExp(`${attr}=([^"\\s,]+)`)
  const unquotedMatch = line.match(unquotedRe)
  if (unquotedMatch) return unquotedMatch[1]

  return ''
}

function parseExtInf(line: string): Omit<M3UEntry, 'url'> {
  const result = { name: '', logo: '', group: '', tvgId: '', tvgName: '' }

  result.tvgId = extractAttribute(line, 'tvg-id')
  result.tvgName = extractAttribute(line, 'tvg-name')
  result.logo = extractAttribute(line, 'tvg-logo')
  result.group = extractAttribute(line, 'group-title')

  // Extract channel name - everything after the last comma
  const commaIdx = line.lastIndexOf(',')
  if (commaIdx !== -1) {
    result.name = line.substring(commaIdx + 1).trim()
  }

  return result
}

function cleanUrlName(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const lastSegment = pathname.split('/').pop() || ''
    // Remove extension
    const dotIdx = lastSegment.lastIndexOf('.')
    const name = dotIdx > 0 ? lastSegment.substring(0, dotIdx) : lastSegment
    return name || 'Bilinmeyen'
  } catch {
    // Fallback for non-URL strings
    const segment = url.split('/').pop() || 'Bilinmeyen'
    const qIdx = segment.indexOf('?')
    const clean = qIdx > 0 ? segment.substring(0, qIdx) : segment
    const dotIdx = clean.lastIndexOf('.')
    return dotIdx > 0 ? clean.substring(0, dotIdx) : clean || 'Bilinmeyen'
  }
}

function stableGroupId(sourceId: string, groupName: string): string {
  // Simple hash based on group name for stable IDs across playlist refreshes
  let hash = 0
  for (let i = 0; i < groupName.length; i++) {
    hash = ((hash << 5) - hash + groupName.charCodeAt(i)) | 0
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  return `${sourceId}_m3u_${hex}`
}

function detectCategoryType(groupName: string, entries: M3UEntry[]): 'live' | 'vod' | 'series' {
  const lower = groupName.toLowerCase()

  if (/\b(series?|dizi|diziler|sezon|season)\b/.test(lower)) return 'series'
  if (/\b(vod|movies?|films?|filmler|sinema|cinema)\b/.test(lower)) return 'vod'

  if (entries.some((e) => /\/series\//i.test(e.url))) return 'series'
  if (entries.some((e) => /\/movie\//i.test(e.url))) return 'vod'

  const vodCount = entries.filter((e) => {
    const ext = e.url.split('.').pop()?.toLowerCase().split('?')[0] || ''
    return VOD_EXTENSIONS.has(ext)
  }).length
  if (vodCount > entries.length * 0.5) return 'vod'

  return 'live'
}

function detectChannelType(url: string): 'live' | 'vod' | 'series' {
  const lower = url.toLowerCase()
  if (/\/series\//.test(lower)) return 'series'
  if (/\/movie\//.test(lower)) return 'vod'
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0] || ''
  if (VOD_EXTENSIONS.has(ext)) return 'vod'
  return 'live'
}

export function parseM3U(content: string, sourceId: string): { channels: Channel[]; categories: Category[] } {
  const lines = content.split(/\r?\n/)
  const entries: M3UEntry[] = []
  let currentEntry: Omit<M3UEntry, 'url'> | null = null
  let pendingGroup: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    if (line.startsWith('#EXTINF:')) {
      currentEntry = parseExtInf(line)
    } else if (line.startsWith('#EXTGRP:')) {
      // #EXTGRP tag provides group name as alternative to group-title attribute
      pendingGroup = line.substring(8).trim()
    } else if (line && !line.startsWith('#') && currentEntry) {
      // Use #EXTGRP group if EXTINF didn't have group-title
      if (!currentEntry.group && pendingGroup) {
        currentEntry.group = pendingGroup
      }
      entries.push({ ...currentEntry, url: line })
      currentEntry = null
      pendingGroup = null
    } else if (line && !line.startsWith('#') && !currentEntry) {
      // URL without EXTINF - create minimal entry
      entries.push({
        name: cleanUrlName(line),
        logo: '',
        group: pendingGroup || '',
        tvgId: '',
        tvgName: '',
        url: line
      })
      pendingGroup = null
    }
  }

  // Group entries by group name for type detection
  const groupedEntries = new Map<string, M3UEntry[]>()
  for (const entry of entries) {
    if (!entry.group) continue
    let list = groupedEntries.get(entry.group)
    if (!list) {
      list = []
      groupedEntries.set(entry.group, list)
    }
    list.push(entry)
  }

  // Detect type for each group
  const groupTypeMap = new Map<string, 'live' | 'vod' | 'series'>()
  for (const [groupName, groupEntries] of groupedEntries) {
    groupTypeMap.set(groupName, detectCategoryType(groupName, groupEntries))
  }

  // Create categories with stable hash-based IDs
  const categories: Category[] = Array.from(groupedEntries.keys()).map((g) => ({
    id: stableGroupId(sourceId, g),
    name: g,
    sourceId,
    type: groupTypeMap.get(g) || 'live'
  }))

  const groupToCategoryId = new Map<string, string>()
  categories.forEach((c) => groupToCategoryId.set(c.name, c.id))

  // Create channels with type matching their category
  const channels: Channel[] = entries.map((e, i) => ({
    id: `${sourceId}_m3u_ch_${i}`,
    name: e.name || e.tvgName || 'Bilinmeyen',
    logo: e.logo || undefined,
    streamUrl: e.url,
    sourceId,
    categoryId: e.group ? groupToCategoryId.get(e.group) : undefined,
    categoryName: e.group || undefined,
    epgChannelId: e.tvgId || undefined,
    group: e.group || undefined,
    type: e.group ? (groupTypeMap.get(e.group) || 'live') : detectChannelType(e.url)
  }))

  return { channels, categories }
}

async function readResponseTextWithLimit(response: Response, maxSizeBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (text.length > maxSizeBytes) throw new Error('Liste boyutu cok buyuk (en fazla 20MB)')
    return text
  }

  const chunks: Uint8Array[] = []
  let totalSize = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalSize += value.length
    if (totalSize > maxSizeBytes) {
      await reader.cancel()
      throw new Error('Liste boyutu cok buyuk (en fazla 20MB)')
    }
  }

  const decoder = new TextDecoder()
  let text = ''
  for (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true })
  }
  text += decoder.decode()
  return text
}

export async function fetchAndParseM3U(url: string, sourceId: string): Promise<ReturnType<typeof parseM3U>> {
  const parsedUrl = new URL(url)
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Yalnızca HTTP/HTTPS oynatma listesi adresleri destekleniyor')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), M3U_FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(parsedUrl.toString(), { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`M3U indirilemedi: ${res.status}`)
    const content = await readResponseTextWithLimit(res, MAX_M3U_SIZE_BYTES)
    return parseM3U(content, sourceId)
  } finally {
    clearTimeout(timeout)
  }
}
