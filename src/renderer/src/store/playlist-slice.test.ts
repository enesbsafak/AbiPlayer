import { defined, itemAt } from '../../../shared/checked'
import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createPlaylistSliceFor, selectedCategoryFor, type PlaylistSlice } from './playlist-slice'
import { createPlayerSlice, DEFAULT_PLAYBACK_TUNING, type PlayerSlice } from './player-slice'
import { createCatalogStore, type CatalogStore } from '@/catalog/catalog-store'
import { categoryToRecord, m3uEntryToRecord } from '@/catalog/convert'
import type { Category, Channel } from '@/types/playlist'

function createTestStore(catalog: CatalogStore = createCatalogStore()) {
  return { catalog, store: create<PlaylistSlice>()((...args) => createPlaylistSliceFor(catalog)(...args)) }
}

function createPlayerTestStore() {
  return create<PlayerSlice>()((...args) => createPlayerSlice(...args))
}

const categories: Category[] = [
  { id: 's1_live_1', name: 'Ulusal', sourceId: 's1', type: 'live' },
  { id: 's1_live_2', name: 'XXX', sourceId: 's1', type: 'live' },
  { id: 's2_live_1', name: 'Haber', sourceId: 's2', type: 'live' }
]

function commitCategories(catalog: CatalogStore, list: Category[]) {
  for (const sourceId of new Set(list.map((category) => category.sourceId))) {
    catalog.commit({
      token: catalog.beginGeneration(sourceId, 'live'),
      mode: 'partial',
      categories: list.filter((category) => category.sourceId === sourceId).map(categoryToRecord)
    })
  }
}

function entry(id: string, sourceId: string, categoryId?: string): Channel {
  return { id, name: id, streamUrl: `http://example.test/${id}.ts`, sourceId, type: 'live', categoryId }
}

describe('playlist-slice category visibility', () => {
  it('toggles a category between hidden and visible', () => {
    const { store } = createTestStore()

    store.getState().toggleCategoryHidden('s1_live_2')
    expect(store.getState().hiddenCategoryIds.has('s1_live_2')).toBe(true)

    store.getState().toggleCategoryHidden('s1_live_2')
    expect(store.getState().hiddenCategoryIds.has('s1_live_2')).toBe(false)
  })

  it('drops the selection when the browsed category gets hidden', () => {
    const { store } = createTestStore()

    store.getState().setSelectedCategory('s1', 'live', 's1_live_2')
    store.getState().toggleCategoryHidden('s1_live_2')

    expect(selectedCategoryFor(store.getState().selectedCategoryIds, 's1', 'live')).toBeNull()
  })

  it('keeps the selection when a different category gets hidden', () => {
    const { store } = createTestStore()

    store.getState().setSelectedCategory('s1', 'live', 's1_live_1')
    store.getState().toggleCategoryHidden('s1_live_2')

    expect(selectedCategoryFor(store.getState().selectedCategoryIds, 's1', 'live')).toBe('s1_live_1')
  })
})

describe('playlist-slice category selection (F1-20)', () => {
  it('keeps one selection per content type', () => {
    const { store } = createTestStore()

    store.getState().setSelectedCategory('s1', 'live', 's1_live_2')

    const selection = store.getState().selectedCategoryIds
    expect(selectedCategoryFor(selection, 's1', 'live')).toBe('s1_live_2')
    // A live category must not filter films or series.
    expect(selectedCategoryFor(selection, 's1', 'vod')).toBeNull()
    expect(selectedCategoryFor(selection, 's1', 'series')).toBeNull()
  })

  it('keeps one selection per source', () => {
    const { store } = createTestStore()

    store.getState().setSelectedCategory('s1', 'vod', 's1_vod_3')
    store.getState().setSelectedCategory('s2', 'vod', 's2_vod_9')
    store.getState().setSelectedCategory('s1', 'vod', null)

    const selection = store.getState().selectedCategoryIds
    expect(selectedCategoryFor(selection, 's1', 'vod')).toBeNull()
    expect(selectedCategoryFor(selection, 's2', 'vod')).toBe('s2_vod_9')
    expect(selectedCategoryFor(selection, null, 'vod')).toBeNull()
  })

  it('does not notify for a selection that did not change', () => {
    const { store } = createTestStore()
    store.getState().setSelectedCategory('s1', 'live', 's1_live_1')
    const before = store.getState().selectedCategoryIds

    store.getState().setSelectedCategory('s1', 'live', 's1_live_1')

    expect(store.getState().selectedCategoryIds).toBe(before)
  })

  it('forgets the selections of a removed source', () => {
    const { store } = createTestStore()
    store.getState().setSelectedCategory('s1', 'live', 's1_live_1')
    store.getState().setSelectedCategory('s2', 'live', 's2_live_1')

    store.getState().removeSourceCatalog('s1')

    expect(store.getState().selectedCategoryIds).toEqual({ s2: { live: 's2_live_1' } })
  })
})

describe('playlist-slice hidden categories per source', () => {
  it('restores only the requested source when showing all', () => {
    const { store, catalog } = createTestStore()
    commitCategories(catalog, categories)
    store.setState({ hiddenCategoryIds: new Set(['s1_live_2', 's2_live_1']) })

    store.getState().showAllCategories('s1')

    expect(store.getState().hiddenCategoryIds).toEqual(new Set(['s2_live_1']))
  })

  it('restores hidden categories of a source whose catalog is not loaded', () => {
    const { store } = createTestStore()
    store.setState({ hiddenCategoryIds: new Set(['s1_vod_7', 's2_live_1']) })

    store.getState().showAllCategories('s1')

    expect(store.getState().hiddenCategoryIds).toEqual(new Set(['s2_live_1']))
  })

  it('restores every source when no source is given', () => {
    const { store, catalog } = createTestStore()
    commitCategories(catalog, categories)
    store.setState({ hiddenCategoryIds: new Set(['s1_live_2', 's2_live_1']) })

    store.getState().showAllCategories()

    expect(store.getState().hiddenCategoryIds.size).toBe(0)
  })

  it('forgets hidden entries when their source is removed', () => {
    const { store, catalog } = createTestStore()
    commitCategories(catalog, categories)
    store.setState({ hiddenCategoryIds: new Set(['s1_live_2', 's2_live_1']) })

    store.getState().removeSourceCatalog('s1')

    expect(store.getState().hiddenCategoryIds).toEqual(new Set(['s2_live_1']))
    expect(catalog.getCategories('s1', 'live')).toEqual([])
  })

  it('keeps hidden entries when the source is refreshed (F1-25)', () => {
    const { store, catalog } = createTestStore()
    commitCategories(catalog, categories)
    store.setState({ hiddenCategoryIds: new Set(['s1_live_2']) })

    store.getState().replaceSourceCatalog('s1', {
      live: { items: [m3uEntryToRecord(entry('a', 's1', 's1_live_2'))], categories: [categoryToRecord(itemAt(categories, 1))] }
    })
    store.getState().replaceSourceCatalog('s1', null)

    expect(store.getState().hiddenCategoryIds).toEqual(new Set(['s1_live_2']))
  })
})

describe('playlist-slice catalog status mirror', () => {
  it('mirrors every status change of the catalog store', () => {
    const { store, catalog } = createTestStore()
    const token = catalog.beginGeneration('s1', 'live')

    catalog.setSyncState(token, { syncing: true })
    expect(store.getState().catalogStatus.s1?.live).toMatchObject({ syncing: true, loaded: false })

    catalog.commit({ token, mode: 'replace', items: [m3uEntryToRecord(entry('a', 's1'))] })
    catalog.setSyncState(token, { syncing: false })
    expect(store.getState().catalogStatus.s1?.live).toMatchObject({
      syncing: false,
      loaded: true,
      complete: true,
      count: 1
    })
    expect(store.getState().catalogStatus.s1?.live).toBe(catalog.getStatus('s1', 'live'))
  })

  it('drops the status and the sync progress of a removed source', () => {
    const { store, catalog } = createTestStore()
    catalog.commit({ token: catalog.beginGeneration('s1', 'vod'), mode: 'partial', items: [] })
    store.getState().setSyncProgress('s1', { currentType: 'vod', completedTypes: 0, active: true })

    store.getState().removeSourceCatalog('s1')

    expect(store.getState().catalogStatus.s1).toBeUndefined()
    expect(store.getState().syncProgress.s1).toBeUndefined()
  })
})

describe('player-slice playback tuning', () => {
  const channel: Channel = {
    id: 'live_1',
    name: 'Kanal 1',
    streamUrl: 'https://cdn.example.com/1.m3u8',
    sourceId: 'source_1',
    type: 'live'
  }

  it('merges partial tuning patches', () => {
    const store = createPlayerTestStore()

    store.getState().setPlaybackTuning({ audioDelay: 0.25 })
    store.getState().setPlaybackTuning({ speed: 1.5 })

    expect(store.getState().playbackTuning).toEqual({
      audioDelay: 0.25,
      subDelay: 0,
      speed: 1.5,
      aspectRatio: 'auto'
    })
  })

  it('resets tuning when a new channel starts', () => {
    // A lip-sync offset that fixed one broadcast is wrong for the next, and a
    // forgotten offset is indistinguishable from a broken stream.
    const store = createPlayerTestStore()

    store.getState().setPlaybackTuning({ audioDelay: -0.4, subDelay: 1.2, aspectRatio: '4:3' })
    store.getState().playChannel(channel)

    expect(store.getState().playbackTuning).toEqual(DEFAULT_PLAYBACK_TUNING)
  })

  it('resets tuning when playback stops', () => {
    const store = createPlayerTestStore()

    store.getState().setPlaybackTuning({ speed: 2 })
    store.getState().stopPlayback()

    expect(store.getState().playbackTuning).toEqual(DEFAULT_PLAYBACK_TUNING)
  })

  it('restores defaults explicitly', () => {
    const store = createPlayerTestStore()

    store.getState().setPlaybackTuning({ audioDelay: 1, speed: 0.75 })
    store.getState().resetPlaybackTuning()

    expect(store.getState().playbackTuning).toEqual(DEFAULT_PLAYBACK_TUNING)
  })
})

describe('player-slice resume flag', () => {
  const movie: Channel = {
    id: 'vod_1',
    name: 'Film',
    streamUrl: 'https://cdn.example.com/movie.mkv',
    sourceId: 'source_1',
    type: 'vod'
  }

  it('arms a resume only when playback is actually started', () => {
    const store = createPlayerTestStore()

    store.getState().playChannel(movie)

    const { pendingResume, currentPlayback } = store.getState()
    expect(pendingResume?.playbackId).toBe(currentPlayback?.playbackId)
    expect(pendingResume?.mediaKey).toBe(currentPlayback?.mediaKey)
  })

  it('never arms one for live', () => {
    const store = createPlayerTestStore()

    store.getState().playChannel({ ...movie, type: 'live' })

    expect(store.getState().pendingResume).toBeNull()
  })

  it('is consumed once so returning to the player cannot re-seek', () => {
    // /player unmounts whenever the viewer drops to the mini player. Coming back
    // must not drag them to a stored position they already scrubbed away from.
    const store = createPlayerTestStore()

    store.getState().playChannel(movie)
    store.getState().completeResume(defined(store.getState().pendingResume, 'the armed resume').playbackId)

    expect(store.getState().pendingResume).toBeNull()
  })

  it('clears on stop', () => {
    const store = createPlayerTestStore()

    store.getState().playChannel(movie)
    store.getState().stopPlayback()

    expect(store.getState().pendingResume).toBeNull()
  })
})

describe('player-slice', () => {
  it('resets video quality state when playback changes or stops', () => {
    const store = createPlayerTestStore()
    const channel: Channel = {
      id: 'vod_1',
      name: 'Film 1080p',
      streamUrl: 'https://cdn.example.com/movie.m3u8',
      sourceId: 'source_1',
      type: 'vod'
    }

    store.getState().applyPlayerPatch({
      videoQualityOptions: [
        { id: 'auto', label: 'Otomatik', shortLabel: 'Oto', auto: true },
        { id: 'hls-v:0', label: '1080p · 5.6 Mbps', shortLabel: '1080p', height: 1080, bitrate: 5_600_000 }
      ],
      activeVideoQuality: 'hls-v:0'
    })
    store.getState().setCurrentVideoQuality('hls-v:0')

    store.getState().playChannel(channel)

    expect(store.getState().videoQualityOptions).toEqual([])
    expect(store.getState().currentVideoQuality).toBeNull()
    expect(store.getState().activeVideoQuality).toBeNull()

    store.getState().applyPlayerPatch({
      videoQualityOptions: [{ id: 'auto', label: 'Otomatik', shortLabel: 'Oto', auto: true }],
      activeVideoQuality: 'hls-v:0'
    })
    store.getState().setCurrentVideoQuality('auto')

    store.getState().stopPlayback()

    expect(store.getState().videoQualityOptions).toEqual([])
    expect(store.getState().currentVideoQuality).toBeNull()
    expect(store.getState().activeVideoQuality).toBeNull()
  })
})
