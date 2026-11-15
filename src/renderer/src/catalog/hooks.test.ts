import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '@/store'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { catalog } from './catalog-store'
import { m3uEntryToRecord } from './convert'
import { useCatalogItem, useCatalogStatus, useVisibleCatalogCategories, useVisibleCatalogItems } from './hooks'
import type { CatalogType } from './types'

function commit(type: CatalogType, ids: string[], mode: 'replace' | 'partial' = 'replace') {
  catalog.commit({
    token: catalog.beginGeneration('s1', type),
    mode,
    items: ids.map((id) =>
      m3uEntryToRecord({ id, name: id, streamUrl: `http://cdn.test/${id}`, sourceId: 's1', type, categoryId: 'c1' })
    )
  })
}

beforeEach(() => {
  catalog.reset()
  useStore.setState({ hiddenCategoryIds: new Set(), settings: { ...DEFAULT_SETTINGS, showAdultContent: true } })
})

afterEach(() => {
  catalog.reset()
  useStore.setState({ hiddenCategoryIds: new Set(), settings: DEFAULT_SETTINGS })
})

describe('catalog hooks', () => {
  it('re-render only for the slice they read', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useVisibleCatalogItems('s1', 'live')
    })
    const afterMount = renders

    act(() => commit('vod', ['film']))
    act(() => commit('series', ['dizi']))
    expect(renders).toBe(afterMount)

    act(() => commit('live', ['kanal']))
    expect(renders).toBe(afterMount + 1)
    expect(result.current.map((item) => item.id)).toEqual(['kanal'])
  })

  it('share one cached list between screens showing the same slice', () => {
    commit('live', ['a', 'b'])
    const first = renderHook(() => useVisibleCatalogItems('s1', 'live'))
    const second = renderHook(() => useVisibleCatalogItems('s1', 'live'))
    expect(first.result.current).toBe(second.result.current)
  })

  it('follow the hidden categories and the adult setting', () => {
    commit('live', ['a'])
    const { result } = renderHook(() => useVisibleCatalogItems('s1', 'live'))
    expect(result.current).toHaveLength(1)

    act(() => useStore.getState().toggleCategoryHidden('c1'))
    expect(result.current).toHaveLength(0)
  })

  it('hide adult categories when adult content is off', () => {
    catalog.commit({
      token: catalog.beginGeneration('s1', 'live'),
      mode: 'partial',
      categories: [
        { id: 'c1', name: 'Ulusal', sourceId: 's1', type: 'live', isAdult: false },
        { id: 'c2', name: 'XXX', sourceId: 's1', type: 'live', isAdult: true }
      ]
    })
    const { result } = renderHook(() => useVisibleCatalogCategories('s1', 'live'))
    expect(result.current.map((category) => category.id)).toEqual(['c1', 'c2'])

    act(() => useStore.getState().updateSettings({ showAdultContent: false }))
    expect(result.current.map((category) => category.id)).toEqual(['c1'])
  })

  it('expose the mirrored status and single records', () => {
    const status = renderHook(() => useCatalogStatus('s1', 'live'))
    const record = renderHook(() => useCatalogItem('kanal'))
    expect(status.result.current).toBeNull()
    expect(record.result.current).toBeUndefined()

    act(() => commit('live', ['kanal']))
    expect(status.result.current).toMatchObject({ complete: true, count: 1 })
    expect(record.result.current?.id).toBe('kanal')
  })

  it('return a stable empty list without a source', () => {
    const { result, rerender } = renderHook(() => useVisibleCatalogItems(null, 'live'))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    expect(first).toEqual([])
  })
})
