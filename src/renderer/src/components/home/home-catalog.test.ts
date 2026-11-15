import { describe, expect, it } from 'vitest'
import { createCatalogStore, type CatalogStore } from '@/catalog/catalog-store'
import { m3uEntryToRecord } from '@/catalog/convert'
import type { CatalogCategory, CatalogItem, CatalogType, CatalogViewSettings } from '@/catalog/types'
import type { EPGData, EPGProgram } from '@/types/epg'
import type { Channel } from '@/types/playlist'
import type { ContinueWatchingItem } from '@/services/watch-progress'
import {
  buildHomeCatalog,
  describeContinue,
  countGuideChannels,
  describeTiles,
  findGuideHighlights,
  HOME_MAX_FILMS,
  pickNewest,
  type TileInput
} from './home-catalog'

function channel(id: string, sourceId: string, type: Channel['type'], categoryId?: string): Channel {
  return { id, name: id, streamUrl: `http://example.test/${id}`, sourceId, type, categoryId }
}

function record(id: string, type: CatalogType, extra: Partial<CatalogItem> = {}): CatalogItem {
  return { id, name: id, streamUrl: '', sourceId: 'a', type, searchName: id, isAdult: false, ...extra }
}

function category(id: string, sourceId: string, type: CatalogType, isAdult = false): CatalogCategory {
  return { id, name: id, sourceId, type, isAdult }
}

function load(store: CatalogStore, channels: Channel[], categories: CatalogCategory[] = []): void {
  for (const type of ['live', 'vod', 'series'] as const) {
    for (const sourceId of new Set(channels.map((c) => c.sourceId))) {
      store.commit({
        token: store.beginGeneration(sourceId, type),
        mode: 'replace',
        items: channels.filter((c) => c.type === type && c.sourceId === sourceId).map(m3uEntryToRecord),
        categories: categories.filter((c) => c.type === type && c.sourceId === sourceId)
      })
    }
  }
}

function homeFor(store: CatalogStore, sourceId: string, settings: CatalogViewSettings) {
  const total = ['live', 'vod', 'series'].reduce(
    (sum, type) => sum + (store.getStatus(sourceId, type as CatalogType)?.count ?? 0),
    0
  )
  return buildHomeCatalog({
    live: store.getVisibleItems(sourceId, 'live', settings),
    vod: store.getVisibleItems(sourceId, 'vod', settings),
    series: store.getVisibleItems(sourceId, 'series', settings),
    totalCount: total
  })
}

const showAdult: CatalogViewSettings = { hiddenCategoryIds: new Set(['hidden']), showAdultContent: true }

describe('buildHomeCatalog', () => {
  const channels = [
    channel('a-live', 'a', 'live'),
    channel('a-hidden', 'a', 'live', 'hidden'),
    channel('a-adult', 'a', 'live', 'adult'),
    channel('a-vod', 'a', 'vod'),
    channel('b-live', 'b', 'live'),
    channel('b-series', 'b', 'series')
  ]
  const categories = [category('hidden', 'a', 'live'), category('adult', 'a', 'live', true)]

  it('counts and lists only the active source, without hidden categories', () => {
    const store = createCatalogStore()
    load(store, channels, categories)
    const home = homeFor(store, 'a', showAdult)

    expect(home.visibleCount).toBe(3)
    expect(home.counts).toEqual({ live: 2, vod: 1, series: 0 })
    expect(home.films.items.map((c) => c.id)).toEqual(['a-vod'])
    expect(home.newestSeries.items).toEqual([])
    expect(home.hasSourceContent).toBe(true)
  })

  it('leaves adult content out of the counts when the setting is off', () => {
    const store = createCatalogStore()
    load(store, channels, categories)
    const home = homeFor(store, 'a', { ...showAdult, showAdultContent: false })
    expect(home.counts.live).toBe(1)
    expect(home.visibleCount).toBe(2)
  })

  it('reports an empty active source even when others have content', () => {
    const store = createCatalogStore()
    load(store, channels, categories)
    const home = homeFor(store, 'c', showAdult)
    expect(home.hasSourceContent).toBe(false)
    expect(home.visibleCount).toBe(0)
  })

  it('puts the newest films first and keeps adult ones out of the row', () => {
    const vod = [
      record('old', 'vod', { added: 100 }),
      record('adult-new', 'vod', { added: 900, categoryId: 'x' }),
      record('new', 'vod', { added: 500 }),
      record('flagged', 'vod', { added: 800, isAdult: true })
    ]
    const home = buildHomeCatalog({ live: [], vod, series: [], totalCount: vod.length, adultCategoryIds: new Set(['x']) })
    expect(home.films).toEqual({ items: [vod[2], vod[0]], dated: true })
  })

  it('caps the film row', () => {
    const many = Array.from({ length: HOME_MAX_FILMS + 5 }, (_, i) => record(`f${i}`, 'vod', { added: i }))
    const home = buildHomeCatalog({ live: [], vod: many, series: [], totalCount: many.length })
    expect(home.films.items).toHaveLength(HOME_MAX_FILMS)
    expect(home.films.items[0]?.id).toBe(`f${HOME_MAX_FILMS + 4}`)
    expect(home.visibleCount).toBe(many.length)
  })
})

describe('pickNewest', () => {
  it('keeps list order for equal dates', () => {
    const items = [{ id: 'a', d: 5 }, { id: 'b', d: 5 }, { id: 'c', d: 7 }]
    expect(pickNewest(items, (item) => item.d, 3).items.map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('gives the first entries of a list without dates, and says they are not the newest', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(pickNewest(items, () => undefined, 2)).toEqual({ items: [items[0], items[1]], dated: false })
  })
})

const NOW = Date.UTC(2026, 10, 14, 18, 0)
const program = (channelId: string, title: string, startMin: number, endMin: number): EPGProgram => ({
  channelId,
  title,
  start: NOW + startMin * 60_000,
  end: NOW + endMin * 60_000
})

function guideWith(programs: Record<string, EPGProgram[]>): EPGData {
  return { channels: {}, programs, lastUpdated: NOW }
}

describe('findGuideHighlights', () => {
  const one = { ...channel('one', 'a', 'live'), name: 'Ulusal 1', epgChannelId: 'One.tr' }
  const two = { ...channel('two', 'a', 'live'), name: 'Spor Arena', epgChannelId: 'two.tr' }

  it('is null without a guide in memory', () => {
    expect(findGuideHighlights(null, [one], NOW)).toBeNull()
  })

  it('takes what is on now and what starts next, in channel order', () => {
    const guide = guideWith({
      'one.tr': [program('one.tr', 'Haber', -30, 30), program('one.tr', 'Ana Haber', 30, 90)],
      'two.tr': [program('two.tr', 'Maç Önü', -10, 20)]
    })
    expect(findGuideHighlights(guide, [two, one], NOW)).toEqual({
      now: { title: 'Maç Önü', channel: 'Spor Arena' },
      next: { start: NOW + 30 * 60_000, title: 'Ana Haber', channel: 'Ulusal 1' }
    })
  })
})

describe('describeTiles', () => {
  const base: TileInput = {
    source: 'ready',
    counts: { live: 0, vod: 0, series: 0 },
    loaded: { live: false, vod: false, series: false },
    films: { items: [], dated: false },
    newestSeries: { items: [], dated: false },
    guide: null,
    guideChannels: null,
    formatTime: () => '21:00'
  }

  it('asks for a source first when there is none', () => {
    const lines = describeTiles({ ...base, source: 'none' })
    expect(Object.values(lines).map((line) => line.text)).toEqual(Array(4).fill('Önce bir kaynak ekle'))
  })

  it('says it is loading, and marks the tile busy, until a list is in', () => {
    const lines = describeTiles({ ...base, source: 'loading' })
    expect(lines.live).toEqual({ text: 'Yükleniyor…', busy: true })
    expect(describeTiles({ ...base, loaded: { live: true, vod: true, series: true } }).vod).toEqual({
      text: 'Bu kaynakta film yok',
      busy: false
    })
    expect(describeTiles({ ...base, source: 'failed' }).series.text).toBe('Kaynak bekleniyor')
  })

  it('leads with the real counts, the specific line under them', () => {
    const lines = describeTiles({
      ...base,
      counts: { live: 9572, vod: 12480, series: 3215 },
      films: { items: [record('Gece Yarısı Treni', 'vod')], dated: true },
      newestSeries: { items: [record('Sessiz Liman', 'series')], dated: true },
      guide: { now: { title: 'Maç Önü', channel: 'Spor Arena' }, next: { start: NOW, title: 'Ana Haber', channel: 'Ulusal 1' } },
      guideChannels: 1204
    })
    expect(lines.live).toEqual({ text: '9.572 kanal', detail: 'Şimdi: Maç Önü · Spor Arena', busy: false })
    expect(lines.epg).toEqual({ text: '1.204 kanalın yayın akışı var', detail: '21:00 Ana Haber · Ulusal 1', busy: false })
    expect(lines.vod).toEqual({ text: '12.480 film', detail: 'Yeni: Gece Yarısı Treni', busy: false })
    expect(lines.series).toEqual({ text: '3.215 dizi', detail: 'Son güncellenen: Sessiz Liman', busy: false })
  })

  it('has no second line without dates or a guide, and a plain guide line without one', () => {
    const lines = describeTiles({
      ...base,
      counts: { live: 2, vod: 10, series: 3 },
      films: { items: [record('first', 'vod')], dated: false }
    })
    expect(lines.vod).toEqual({ text: '10 film', detail: undefined, busy: false })
    expect(lines.series.text).toBe('3 dizi')
    expect(lines.live.detail).toBeUndefined()
    expect(lines.epg.text).toBe('Şimdi ve sıradaki yayınlar')
  })

  it('names the next programme on the guide tile when the guide covers none of the list', () => {
    const lines = describeTiles({ ...base, guide: { now: null, next: { start: NOW, title: 'Ana Haber', channel: 'Ulusal 1' } }, guideChannels: 0 })
    expect(lines.epg.text).toBe('21:00 Ana Haber · Ulusal 1')
  })
})

describe('countGuideChannels', () => {
  it('counts the channels with programmes, and is null without a guide', () => {
    const one = { ...channel('one', 'a', 'live'), epgChannelId: 'One.tr' }
    const two = { ...channel('two', 'a', 'live'), epgChannelId: 'two.tr' }
    const three = channel('three', 'a', 'live')
    expect(countGuideChannels(null, [one])).toBeNull()
    expect(countGuideChannels(guideWith({ 'one.tr': [program('one.tr', 'Haber', 0, 30)], 'two.tr': [] }), [one, two, three])).toBe(1)
  })
})

describe('describeContinue', () => {
  it('states the kind, year and length, the share watched and the time left', () => {
    const item = {
      entry: { key: 'k', target: null, channel: {}, position: 3840, duration: 6720, updatedAt: NOW },
      target: {},
      channel: { ...channel('Kayıp Şehir', 'a', 'vod'), year: '2024' }
    } as unknown as ContinueWatchingItem
    expect(describeContinue(item)).toEqual({ meta: 'Film · 2024 · 1 sa 52 dk', percent: 57, remaining: '48 dk kaldı' })
  })
})
