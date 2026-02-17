import type { Channel, Category } from '@/types/playlist'

interface M3UEntry {
  name: string
  logo: string
  group: string
  tvgId: string
  tvgName: string
  url: string
}

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
        name: line.split('/').pop() || 'Unknown',
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
    name: e.name || e.tvgName || 'Unknown',
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

export async function fetchAndParseM3U(url: string, sourceId: string): Promise<ReturnType<typeof parseM3U>> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch M3U: ${res.status}`)
  const content = await res.text()
  return parseM3U(content, sourceId)
}
