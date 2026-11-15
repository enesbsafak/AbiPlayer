import { describe, expect, it } from 'vitest'
import type { CatalogItem } from '@/catalog/types'
import type { EPGData, EPGProgram } from '@/types/epg'
import { buildEpgRows, createTimeFormatter, epgNotice } from './EPGPage'

function channel(id: string, epgChannelId?: string): CatalogItem {
  return { id, name: `Kanal ${id}`, streamUrl: '', streamId: 1, sourceId: 's', type: 'live', searchName: `kanal ${id}`, isAdult: false, epgChannelId }
}

function guide(programs: Record<string, EPGProgram[]>, extra: Partial<EPGData> = {}): EPGData {
  const map = Object.create(null) as Record<string, EPGProgram[]>
  Object.assign(map, programs)
  return { channels: Object.create(null), programs: map, lastUpdated: 1, ...extra }
}

const program = (channelId: string, title: string): EPGProgram => ({ channelId, title, start: 0, end: 1 })

describe('EPG page model', () => {
  it('lists the channels that have guide data, in list order, matching the search', () => {
    const data = guide({ 'trt1.tr': [program('trt1.tr', 'Haber')], 'atv.tr': [program('atv.tr', 'Dizi')] })
    const channels = [channel('1', 'TRT1.tr'), channel('2'), channel('3', 'atv.tr'), channel('4', 'yok.tr')]
    expect(buildEpgRows(channels, data, '').map((row) => row.channel.id)).toEqual(['1', '3'])
    expect(buildEpgRows(channels, data, 'kanal 3').map((row) => row.channel.id)).toEqual(['3'])
    expect(buildEpgRows(channels, null, '')).toEqual([])
  })

  it('honours the time format setting', () => {
    const afternoon = new Date(2026, 10, 15, 14, 5).getTime()
    expect(createTimeFormatter('24h')(afternoon)).toBe('14:05')
    const twelve = createTimeFormatter('12h')(afternoon)
    expect(twelve).toMatch(/2:05/)
    expect(twelve).not.toMatch(/14/)
  })

  it('says when the guide could not be loaded in full, or is an older copy', () => {
    const complete = guide({})
    expect(epgNotice({ guide: complete, fromCache: false, error: null, fetchedAt: 1, loading: false })).toBeNull()
    expect(epgNotice({ guide: guide({}, { truncated: true, truncatedReason: 'cut-off' }), fromCache: false, error: null, fetchedAt: 1, loading: false })).toMatchObject({
      tone: 'warning',
      text: expect.stringContaining('tamamı yüklenemedi')
    })
    expect(epgNotice({ guide: guide({}, { truncated: true, truncatedReason: 'limit' }), fromCache: false, error: null, fetchedAt: 1, loading: false })?.text).toMatch(/sınırına ulaşıldı/)
    expect(epgNotice({ guide: complete, fromCache: true, error: 'Sunucuya ulaşılamadı.', fetchedAt: Date.UTC(2026, 10, 14), loading: false })?.text).toMatch(
      /^Yayın akışı güncellenemedi: Sunucuya ulaşılamadı\. .+ tarihli kopya gösteriliyor\.$/
    )
    expect(epgNotice({ guide: complete, fromCache: true, error: null, fetchedAt: Date.UTC(2026, 10, 14), loading: true })).toMatchObject({ tone: 'info' })
  })
})
