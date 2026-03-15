import { describe, expect, it } from 'vitest'
import { buildCatalogRetainResetKey } from './catalog-view'

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
