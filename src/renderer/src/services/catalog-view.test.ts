import { describe, expect, it } from 'vitest'
import {
  applyCatalogView,
  applyCategoryView,
  buildCatalogRetainResetKey,
  type CatalogViewOptions
} from './catalog-view'
import type { Category, Channel } from '@/types/playlist'

function channel(name: string, extra: Partial<Channel> = {}): Channel {
  return {
    id: `id_${name}`,
    name,
    streamUrl: `https://example.com/${name}.m3u8`,
    sourceId: 's1',
    type: 'live',
    ...extra
  }
}

function category(id: string, name: string, extra: Partial<Category> = {}): Category {
  return { id, name, sourceId: 's1', type: 'live', ...extra }
}

const baseOptions: CatalogViewOptions = {
  hiddenCategoryIds: new Set(),
  adultCategoryIds: new Set(),
  sortMode: 'name'
}

describe('catalog-view', () => {
  it('changes the retain reset key when the selected category changes', () => {
    expect(buildCatalogRetainResetKey('source_1', 'source_1_series_10')).not.toBe(
      buildCatalogRetainResetKey('source_1', 'source_1_series_11')
    )
  })

  it('keeps the same retain reset key for the same source and category', () => {
    expect(buildCatalogRetainResetKey('source_1', 'source_1_series_10')).toBe(
      buildCatalogRetainResetKey('source_1', 'source_1_series_10')
    )
  })

  it('uses a stable key for the all-items view', () => {
    expect(buildCatalogRetainResetKey('source_1', null)).toBe('source_1:__all__')
  })
})

describe('applyCatalogView', () => {
  it('sorts by name with natural number ordering', () => {
    const list = [channel('TRT 10'), channel('TRT 2'), channel('Aksiyon')]
    const result = applyCatalogView(list, baseOptions)
    expect(result.map((c) => c.name)).toEqual(['Aksiyon', 'TRT 2', 'TRT 10'])
  })

  it('ignores case and diacritics when sorting', () => {
    const list = [channel('Şok TV'), channel('beIN SPORTS'), channel('Ada TV')]
    const result = applyCatalogView(list, baseOptions)
    expect(result.map((c) => c.name)).toEqual(['Ada TV', 'beIN SPORTS', 'Şok TV'])
  })

  it('keeps provider order in source mode', () => {
    const list = [channel('Zed TV'), channel('Ada TV'), channel('Mor TV')]
    const result = applyCatalogView(list, { ...baseOptions, sortMode: 'source' })
    expect(result.map((c) => c.name)).toEqual(['Zed TV', 'Ada TV', 'Mor TV'])
  })

  // Name-based detection is the parsers' job (they set `isAdult` once at parse
  // time); this layer only reads the flag and the adult-category set, so a
  // 50k-channel sort never re-runs the pattern list.
  it('pushes adult channels to the end in name mode', () => {
    const list = [channel('XXX Kanal', { isAdult: true }), channel('Ada TV'), channel('Zed TV')]
    const result = applyCatalogView(list, baseOptions)
    expect(result.map((c) => c.name)).toEqual(['Ada TV', 'Zed TV', 'XXX Kanal'])
  })

  it('pushes adult channels to the end in source mode too', () => {
    // This is the reported bug: providers ship adult groups first and the app
    // showed them first because it preserved playlist order verbatim.
    const list = [
      channel('Erotik 1', { isAdult: true }),
      channel('Erotik 2', { isAdult: true }),
      channel('Haber TV'),
      channel('Ada TV')
    ]
    const result = applyCatalogView(list, { ...baseOptions, sortMode: 'source' })
    expect(result.map((c) => c.name)).toEqual(['Haber TV', 'Ada TV', 'Erotik 1', 'Erotik 2'])
  })

  it('treats a channel in an adult category as adult even when its own name is clean', () => {
    const list = [channel('Kanal 1', { categoryId: 'cat_adult' }), channel('Zed TV')]
    const result = applyCatalogView(list, {
      ...baseOptions,
      adultCategoryIds: new Set(['cat_adult'])
    })
    expect(result.map((c) => c.name)).toEqual(['Zed TV', 'Kanal 1'])
  })

  it('drops channels whose category is hidden', () => {
    const list = [
      channel('Ada TV', { categoryId: 'cat_1' }),
      channel('Gizli TV', { categoryId: 'cat_hidden' }),
      channel('Zed TV')
    ]
    const result = applyCatalogView(list, {
      ...baseOptions,
      hiddenCategoryIds: new Set(['cat_hidden'])
    })
    expect(result.map((c) => c.name)).toEqual(['Ada TV', 'Zed TV'])
  })

  it('keeps uncategorised channels when other categories are hidden', () => {
    const list = [channel('Kategorisiz'), channel('Gizli', { categoryId: 'cat_hidden' })]
    const result = applyCatalogView(list, {
      ...baseOptions,
      hiddenCategoryIds: new Set(['cat_hidden'])
    })
    expect(result.map((c) => c.name)).toEqual(['Kategorisiz'])
  })

  it('does not mutate the input list', () => {
    const list = [channel('Zed TV'), channel('Ada TV')]
    applyCatalogView(list, baseOptions)
    expect(list.map((c) => c.name)).toEqual(['Zed TV', 'Ada TV'])
  })
})

describe('applyCategoryView', () => {
  it('hides hidden categories and sorts the rest', () => {
    const list = [
      category('c1', 'Ulusal'),
      category('c2', 'Gizli'),
      category('c3', 'Belgesel')
    ]
    const result = applyCategoryView(list, {
      hiddenCategoryIds: new Set(['c2']),
      sortMode: 'name'
    })
    expect(result.map((c) => c.name)).toEqual(['Belgesel', 'Ulusal'])
  })

  it('pushes adult categories to the end', () => {
    const list = [category('c1', 'XXX'), category('c2', 'Ulusal'), category('c3', 'Spor')]
    const result = applyCategoryView(list, { hiddenCategoryIds: new Set(), sortMode: 'name' })
    expect(result.map((c) => c.name)).toEqual(['Spor', 'Ulusal', 'XXX'])
  })

  it('keeps hidden categories when includeHidden is set', () => {
    const list = [category('c1', 'Ulusal'), category('c2', 'Gizli')]
    const result = applyCategoryView(list, {
      hiddenCategoryIds: new Set(['c2']),
      sortMode: 'name',
      includeHidden: true
    })
    expect(result.map((c) => c.name)).toEqual(['Gizli', 'Ulusal'])
  })
})
