import { describe, expect, it } from 'vitest'
import { collectAdultCategoryIds, isAdultLabel } from './adult-content'
import type { Category } from '@/types/playlist'

describe('isAdultLabel', () => {
  it('matches the common explicit markers', () => {
    expect(isAdultLabel('XXX')).toBe(true)
    expect(isAdultLabel('TR - XXX HD')).toBe(true)
    expect(isAdultLabel('Adult')).toBe(true)
    expect(isAdultLabel('FOR ADULTS ONLY')).toBe(true)
    expect(isAdultLabel('Erotik Kanallar')).toBe(true)
    expect(isAdultLabel('Erotic Channels')).toBe(true)
    expect(isAdultLabel('Porno TV')).toBe(true)
    expect(isAdultLabel('Sexy Hot')).toBe(true)
  })

  it('matches age markers in both orders', () => {
    expect(isAdultLabel('+18')).toBe(true)
    expect(isAdultLabel('18+')).toBe(true)
    expect(isAdultLabel('18 + Kanallar')).toBe(true)
    expect(isAdultLabel('18 Yas Ustu')).toBe(true)
  })

  it('matches Turkish labels regardless of diacritics or casing', () => {
    expect(isAdultLabel('Yetişkin')).toBe(true)
    expect(isAdultLabel('YETİŞKİN')).toBe(true)
    expect(isAdultLabel('yetiskin')).toBe(true)
    expect(isAdultLabel('EROTİK')).toBe(true)
  })

  it('matches unambiguous adult brands', () => {
    expect(isAdultLabel('Brazzers TV')).toBe(true)
    expect(isAdultLabel('Playboy HD')).toBe(true)
    expect(isAdultLabel('Hustler TV')).toBe(true)
    expect(isAdultLabel('Penthouse Gold')).toBe(true)
    expect(isAdultLabel('Dorcel TV')).toBe(true)
    expect(isAdultLabel('RedLight')).toBe(true)
  })

  it('does not match ordinary channels that merely contain the letters', () => {
    // These are the reason every pattern is word-bounded.
    expect(isAdultLabel('Sussex Local TV')).toBe(false)
    expect(isAdultLabel('Middlesex News')).toBe(false)
    expect(isAdultLabel('Hotbird Promo')).toBe(false)
    expect(isAdultLabel('Hotel Channel')).toBe(false)
    expect(isAdultLabel('Ulusal')).toBe(false)
    expect(isAdultLabel('Spor')).toBe(false)
    expect(isAdultLabel('TRT 1')).toBe(false)
    expect(isAdultLabel('Belgesel 18')).toBe(false)
  })

  it('treats empty input as not adult', () => {
    expect(isAdultLabel('')).toBe(false)
    expect(isAdultLabel(null)).toBe(false)
    expect(isAdultLabel(undefined)).toBe(false)
  })
})

describe('collectAdultCategoryIds', () => {
  it('collects only the adult category ids', () => {
    const categories: Category[] = [
      { id: 'c1', name: 'Ulusal', sourceId: 's1', type: 'live' },
      { id: 'c2', name: 'XXX', sourceId: 's1', type: 'live' },
      { id: 'c3', name: 'Spor', sourceId: 's1', type: 'live' },
      { id: 'c4', name: 'Yetişkin Filmler', sourceId: 's1', type: 'vod' }
    ]

    expect(collectAdultCategoryIds(categories)).toEqual(new Set(['c2', 'c4']))
  })

  it('returns an empty set for a clean catalog', () => {
    const categories: Category[] = [{ id: 'c1', name: 'Haber', sourceId: 's1', type: 'live' }]
    expect(collectAdultCategoryIds(categories).size).toBe(0)
  })
})
