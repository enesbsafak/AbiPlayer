import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createCatalogStore } from '@/catalog/catalog-store'
import { m3uEntryToRecord, xtreamVodToRecords } from '@/catalog/convert'
import { resolveFavoriteChannels } from '@/components/favorites/favorite-channels'
import { isPlayableChannel, targetFromChannel } from '@/services/playback'
import {
  channelFromFavoriteSnapshot,
  createFavoritesSliceFor,
  favoriteSnapshotOf,
  isM3uSnapshotChannel,
  sanitizeFavoriteSnapshot,
  stripSnapshotStreamUrls,
  type FavoritesSlice
} from './favorites-slice'
import { mergePersistedState, useStore } from './index'
import { seedFavoriteSnapshots } from './persist-migrations'

const film = xtreamVodToRecords(
  [
    {
      num: 1, name: 'Film', stream_type: 'movie', stream_id: 7, stream_icon: 'http://img/f.jpg', rating: '7',
      rating_5based: 3.5, added: '', is_adult: false, category_id: '2', category_ids: [], container_extension: 'mkv',
      custom_sid: '', direct_source: ''
    }
  ],
  'x'
)[0]
const entry = m3uEntryToRecord({
  id: 'm_ch_1',
  name: 'Liste Kanalı',
  streamUrl: 'http://cdn.test/1.m3u8',
  sourceId: 'm',
  type: 'live',
  group: 'Haber'
})

function storeWith(catalog = createCatalogStore()) {
  return { catalog, store: create<FavoritesSlice>()((...args) => createFavoritesSliceFor(catalog)(...args)) }
}

describe('favourite snapshots (F1-42)', () => {
  it('takes the snapshot from the catalog record when a favourite is added', () => {
    const { catalog, store } = storeWith()
    catalog.commit({ token: catalog.beginGeneration('x', 'vod'), mode: 'replace', items: [film] })

    store.getState().toggleFavorite(film.id)

    expect(store.getState().favoriteSnapshots[film.id]).toEqual({
      id: 'x_vod_7',
      name: 'Film',
      sourceId: 'x',
      type: 'vod',
      streamId: 7,
      containerExtension: 'mkv',
      logo: 'http://img/f.jpg',
      categoryId: 'x_vod_2',
      rating: '7'
    })

    store.getState().toggleFavorite(film.id)
    expect(store.getState().favoriteSnapshots).toEqual({})
  })

  // F3-02: M3U entry URLs usually hold the account password as well.
  it('keeps no URL, neither an M3U entry one nor an Xtream one', () => {
    const snapshot = favoriteSnapshotOf(entry)
    expect(snapshot).toMatchObject({ id: 'm_ch_1', m3u: true, categoryName: 'Haber' })
    expect(snapshot).not.toHaveProperty('streamUrl')
    expect(favoriteSnapshotOf({ ...film, streamUrl: 'http://panel/movie/u/p/7.mkv' })).not.toHaveProperty('streamUrl')
  })

  it('renders a favourite from its snapshot when the catalog is not loaded; an M3U one waits for its playlist', () => {
    const snapshots = { [film.id]: favoriteSnapshotOf(film), [entry.id]: favoriteSnapshotOf(entry) }
    const channels = resolveFavoriteChannels(
      new Set([film.id, entry.id]),
      snapshots,
      () => undefined,
      new Set(['x', 'm'])
    )

    expect(channels.map((channel) => channel.id)).toEqual([film.id, entry.id])
    expect(isPlayableChannel(channels[0])).toBe(true)
    expect(isM3uSnapshotChannel(channels[0])).toBe(false)
    // No URL to play yet: the card is shown and looks the entry up once loaded.
    expect(isPlayableChannel(channels[1])).toBe(false)
    expect(isM3uSnapshotChannel(channels[1])).toBe(true)
    expect(targetFromChannel(channels[0])).toEqual({
      kind: 'movie',
      sourceId: 'x',
      streamId: 7,
      containerExtension: 'mkv'
    })
  })

  it('prefers the live record and leaves out favourites of deleted sources', () => {
    const renamed = { ...entry, name: 'Yeni Ad' }
    const channels = resolveFavoriteChannels(
      new Set([film.id, entry.id]),
      { [film.id]: favoriteSnapshotOf(film), [entry.id]: favoriteSnapshotOf(entry) },
      (id) => (id === entry.id ? renamed : undefined),
      new Set(['m'])
    )
    expect(channels).toEqual([renamed])
  })

  it('survives a restart: persisted snapshots render before any catalog loads', () => {
    const merged = mergePersistedState(
      { favoriteIds: [film.id], favoriteSnapshots: [favoriteSnapshotOf(film)] },
      useStore.getState()
    )
    const channels = resolveFavoriteChannels(
      merged.favoriteIds,
      merged.favoriteSnapshots,
      () => undefined,
      new Set(['x'])
    )
    expect(channels.map((channel) => channel.name)).toEqual(['Film'])
  })

  it('round-trips through sanitize', () => {
    const snapshot = favoriteSnapshotOf(film)
    expect(sanitizeFavoriteSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
    expect(channelFromFavoriteSnapshot(snapshot).streamUrl).toBe('')
    expect(sanitizeFavoriteSnapshot({ id: 'a', name: 'b', sourceId: 'c', type: 'radio', streamId: 1 })).toBeNull()
  })
})

describe('favorite-snapshots migration', () => {
  const watchProgress = [
    {
      key: 'movie:x:7',
      target: { kind: 'movie', sourceId: 'x', streamId: 7, containerExtension: 'mkv' },
      channel: { id: 'x_vod_7', name: 'Film', streamUrl: '', sourceId: 'x', type: 'vod', coverUrl: 'http://img/c.jpg' }
    },
    {
      key: 'm3u:m:1',
      target: { kind: 'm3u', sourceId: 'm', entryId: 1, mediaType: 'live' },
      channel: { id: 'm_ch_1', name: 'Liste', streamUrl: 'http://cdn.test/1.m3u8', sourceId: 'm', type: 'live' }
    },
    { key: 'legacy', target: null, channel: { id: 'x_live_3', name: 'Eski', streamUrl: '', sourceId: 'x', type: 'live' } }
  ]

  it('seeds snapshots of watched favourites from their history entries; the next step drops the URL', () => {
    const seeded = seedFavoriteSnapshots(['x_vod_7', 'm_ch_1', 'x_live_3', 'x_series_9'], undefined, watchProgress)
    expect(seeded[1]).toMatchObject({ streamUrl: 'http://cdn.test/1.m3u8' })
    expect(stripSnapshotStreamUrls(seeded) as unknown[]).toHaveLength(2)
    expect((stripSnapshotStreamUrls(seeded) as unknown[]).map((snapshot) => sanitizeFavoriteSnapshot(snapshot))).toEqual([
      {
        id: 'x_vod_7',
        name: 'Film',
        sourceId: 'x',
        type: 'vod',
        streamId: 7,
        containerExtension: 'mkv',
        coverUrl: 'http://img/c.jpg'
      },
      { id: 'm_ch_1', name: 'Liste', sourceId: 'm', type: 'live', m3u: true }
    ])
    expect(stripSnapshotStreamUrls(seeded)).toEqual([seeded[0], { id: 'm_ch_1', name: 'Liste', sourceId: 'm', type: 'live', m3u: true }])
  })

  it('strips stored URLs idempotently and leaves anything else alone', () => {
    const once = stripSnapshotStreamUrls([{ id: 'a', streamUrl: 'http://u:p@cdn/1.ts' }, null, 3])
    expect(once).toEqual([{ id: 'a', m3u: true }, null, 3])
    expect(stripSnapshotStreamUrls(once)).toEqual(once)
    expect(stripSnapshotStreamUrls('garbage')).toBe('garbage')
  })

  it('is idempotent and tolerates any shape', () => {
    const once = seedFavoriteSnapshots(['x_vod_7'], [], watchProgress)
    expect(seedFavoriteSnapshots(['x_vod_7'], once, watchProgress)).toEqual(once)
    expect(seedFavoriteSnapshots('garbage', 5, null)).toEqual([])
    expect(seedFavoriteSnapshots(['a'], [{ id: 'a' }], [null, 3, { channel: 'x' }])).toEqual([{ id: 'a' }])
  })
})
