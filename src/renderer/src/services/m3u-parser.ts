import type { Channel, Category } from '@/types/playlist'

interface M3UEntry {
  name: string
  logo: string
  group: string
  tvgId: string
  tvgName: string
  url: string
}

const M3U_FETCH_TIMEOUT_MS = 30_000
const MAX_M3U_SIZE_BYTES = 20 * 1024 * 1024

function parseExtInf(line: string): Omit<M3UEntry, 'url'> {
  const result = { name: '', logo: '', group: '', tvgId: '', tvgName: '' }

  // Extract attributes from #EXTINF line
  const tvgIdMatch = line.match(/tvg-id="([^"]*)"/)
  const tvgNameMatch = line.match(/tvg-name="([^"]*)"/)
  const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/)
  const groupMatch = line.match(/group-title="([^"]*)"/)

  if (tvgIdMatch) result.tvgId = tvgIdMatch[1]
  if (tvgNameMatch) result.tvgName = tvgNameMatch[1]
  if (tvgLogoMatch) result.logo = tvgLogoMatch[1]
  if (groupMatch) result.group = groupMatch[1]

  // Extract channel name - everything after the last comma
  const commaIdx = line.lastIndexOf(',')
  if (commaIdx !== -1) {
    result.name = line.substring(commaIdx + 1).trim()
  }

  return result
}

export function parseM3U(content: string, sourceId: string): { channels: Channel[]; categories: Category[] } {
  const lines = content.split(/\r?\n/)
  const entries: M3UEntry[] = []
  let currentEntry: Omit<M3UEntry, 'url'> | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    if (line.startsWith('#EXTINF:')) {
      currentEntry = parseExtInf(line)
    } else if (line && !line.startsWith('#') && currentEntry) {
      entries.push({ ...currentEntry, url: line })
      currentEntry = null
    } else if (line && !line.startsWith('#') && !currentEntry) {
      // URL without EXTINF - create minimal entry
      entries.push({
        name: line.split('/').pop() || 'Bilinmeyen',
        logo: '',
        group: '',
        tvgId: '',
        tvgName: '',
        url: line
      })
    }
  }

  // Collect unique groups
  const groupSet = new Set<string>()
  entries.forEach((e) => {
    if (e.group) groupSet.add(e.group)
  })

  const categories: Category[] = Array.from(groupSet).map((g, i) => ({
    id: `${sourceId}_m3u_${i}`,
    name: g,
    sourceId,
    type: 'live' as const
  }))

  const groupToCategoryId = new Map<string, string>()
  categories.forEach((c) => groupToCategoryId.set(c.name, c.id))

  // Detect stream type from URL
  function detectType(url: string): 'live' | 'vod' {
    const ext = url.split('.').pop()?.toLowerCase().split('?')[0]
    if (ext && ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv'].includes(ext)) return 'vod'
    return 'live'
  }

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
    type: detectType(e.url)
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
    throw new Error('Yalnizca HTTP/HTTPS oynatma listesi adresleri destekleniyor')
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
