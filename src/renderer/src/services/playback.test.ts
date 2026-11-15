import { describe, expect, it } from 'vitest'
import { createCatalogStore } from '@/catalog/catalog-store'
import { m3uPlaylistToReplacement } from '@/catalog/convert'
import { parseM3U } from './m3u-parser'
import { findM3uEntry, resolveStreamUrl } from './playback'
import { itemAt } from '../../../shared/checked'
import { m3uEntryId, type PlaybackTarget } from '../../../shared/playback'

const FILM_URL = 'http://panel.test/movie/ali/s3cret/7.mkv'
const PLAYLIST = [
  '#EXTM3U',
  '#EXTINF:-1 group-title="Filmler",Film',
  FILM_URL,
  '#EXTINF:-1 group-title="Haber",Kanal',
  'http://panel.test/live/ali/s3cret/1.ts'
].join('\n')

function loadedCatalog() {
  const store = createCatalogStore()
  store.replaceSource('m', m3uPlaylistToReplacement(parseM3U(PLAYLIST, 'm')))
  return store
}

describe('findM3uEntry (F3-02)', () => {
  const target: Extract<PlaybackTarget, { kind: 'm3u' }> = {
    kind: 'm3u',
    sourceId: 'm',
    entryId: m3uEntryId(FILM_URL),
    mediaType: 'vod'
  }

  it('finds the URL of a stored entry in the loaded playlist, by id first', () => {
    const store = loadedCatalog()
    const film = itemAt(store.getItems('m', 'vod'), 0)
    expect(findM3uEntry(target, store, film.id)?.streamUrl).toBe(FILM_URL)
    // The stored id may be stale (the entry moved): the entry id still finds it.
    expect(findM3uEntry(target, store, 'm_m3u_ch_old')?.streamUrl).toBe(FILM_URL)

    const entry = findM3uEntry(target, store)!
    expect(resolveStreamUrl(target, { credentials: null, entryUrl: entry.streamUrl })).toBe(FILM_URL)
  })

  it('finds nothing before the playlist is loaded or once it no longer lists the entry', () => {
    expect(findM3uEntry(target, createCatalogStore())).toBeNull()
    const store = loadedCatalog()
    expect(findM3uEntry({ ...target, entryId: m3uEntryId('http://elsewhere/2.mkv') }, store)).toBeNull()
    expect(findM3uEntry({ ...target, sourceId: 'other' }, store)).toBeNull()
  })
})
