import { describe, expect, it } from 'vitest'
import { describeAddonTiles } from './home-catalog'

describe('the home tiles of an add-on source', () => {
  it('count catalogues (their sizes are unknown) and name the first few', () => {
    const lines = describeAddonTiles({ vodCatalogs: ['Popüler', 'Yeni', 'Klasik', 'Belgesel'], seriesCatalogs: ['Yeni Diziler'] })
    expect(lines.vod).toEqual({ text: '4 katalog', detail: 'Popüler, Yeni, Klasik', busy: false })
    expect(lines.series).toEqual({ text: '1 katalog', detail: 'Yeni Diziler', busy: false })
  })

  it('say calmly that there is no live TV and no guide, and that a type is missing', () => {
    const lines = describeAddonTiles({ vodCatalogs: [], seriesCatalogs: ['Yeni Diziler'] })
    expect(lines.live).toEqual({ text: 'Bu kaynakta canlı TV yok', busy: false })
    expect(lines.epg).toEqual({ text: 'Bu kaynakta yayın akışı yok', busy: false })
    expect(lines.vod).toEqual({ text: 'Bu kaynakta film yok', busy: false })
    // Nothing spins: nothing is on its way.
    expect(Object.values(lines).some((line) => line.busy)).toBe(false)
  })
})
