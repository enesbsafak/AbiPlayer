import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import { createCatalogStore } from '@/catalog/catalog-store'
import { m3uPlaylistToReplacement } from '@/catalog/convert'
import { parseM3U } from '@/services/m3u-parser'
import { ENTRY_GONE_MESSAGE, useDeferredPlayback, type DeferredPlayRequest } from './useDeferredPlayback'

const FILM_URL = 'http://panel.test/movie/ali/s3cret/7.mkv'
const PLAYLIST = `#EXTM3U\n#EXTINF:-1 group-title="Filmler",Film\n${FILM_URL}\n`

function request(store: ReturnType<typeof createCatalogStore>, id: string): DeferredPlayRequest {
  return { sourceId: 'm', name: 'Film', resolve: () => store.getItem(id) ?? null }
}

beforeEach(() => {
  useStore.setState({
    sources: [{ id: 'm', name: 'Liste', type: 'm3u_url', addedAt: 1 }],
    sourceErrors: {},
    connectRetryToken: 0
  })
})

afterEach(() => {
  cleanup()
  useStore.setState({ sources: [], sourceErrors: {} })
})

describe('useDeferredPlayback (F3-02)', () => {
  it('waits for the playlist of a stored M3U item and plays it once it is in', async () => {
    const store = createCatalogStore()
    const filmId = parseM3U(PLAYLIST, 'm').channels[0].id
    const play = vi.fn()
    const { result } = renderHook(() => useDeferredPlayback(store))

    act(() => result.current.playWhenReady(request(store, filmId), play))
    expect(play).not.toHaveBeenCalled()
    expect(result.current.notice).toMatchObject({ pending: true })

    await act(async () => {
      store.replaceSource('m', m3uPlaylistToReplacement(parseM3U(PLAYLIST, 'm')))
      await Promise.resolve()
    })
    expect(play).toHaveBeenCalledTimes(1)
    expect(play.mock.calls[0][0].streamUrl).toBe(FILM_URL)
    expect(result.current.notice).toBeNull()
  })

  // P8: the wait used to outlive another start and then replace it.
  it('drops the wait once something else is started', async () => {
    const store = createCatalogStore()
    const filmId = parseM3U(PLAYLIST, 'm').channels[0].id
    const play = vi.fn()
    const { result } = renderHook(() => useDeferredPlayback(store))
    act(() => result.current.playWhenReady(request(store, filmId), play))

    act(() => {
      useStore.getState().playChannel({ id: 'x', name: 'Başka', streamUrl: 'http://cdn.test/x.m3u8', sourceId: 'k', type: 'live' })
    })
    expect(result.current.notice).toBeNull()

    await act(async () => {
      store.replaceSource('m', m3uPlaylistToReplacement(parseM3U(PLAYLIST, 'm')))
      await Promise.resolve()
    })
    expect(play).not.toHaveBeenCalled()
    useStore.getState().stopPlayback()
  })

  it('says the entry is gone when the loaded playlist no longer lists it', () => {
    const store = createCatalogStore()
    store.replaceSource('m', m3uPlaylistToReplacement(parseM3U(PLAYLIST, 'm')))
    const play = vi.fn()
    const { result } = renderHook(() => useDeferredPlayback(store))

    act(() => result.current.playWhenReady(request(store, 'm_m3u_ch_missing'), play))
    expect(play).not.toHaveBeenCalled()
    expect(result.current.notice).toEqual({ message: ENTRY_GONE_MESSAGE, pending: false })
  })

  it('asks a failed source to connect again and gives up on one that needs the user', () => {
    const store = createCatalogStore()
    useStore.setState({ sourceErrors: { m: { kind: 'other', message: 'Sunucuya ulaşılamadı.', retryAt: Date.now() + 5000 } } })
    const { result } = renderHook(() => useDeferredPlayback(store))

    act(() => result.current.playWhenReady(request(store, 'x'), vi.fn()))
    expect(useStore.getState().connectRetryToken).toBe(1)
    expect(result.current.notice?.pending).toBe(true)

    act(() => {
      useStore.setState({ sourceErrors: { m: { kind: 'missing-secret', message: 'Kayıtlı liste adresi bulunamadı.', retryAt: null } } })
    })
    expect(result.current.notice).toEqual({ message: 'Kayıtlı liste adresi bulunamadı.', pending: false })
  })
})
