import { describe, expect, it, vi } from 'vitest'
import {
  createPlayerReturnTarget,
  navigateToPlayerReturnTarget,
  openPlayerFromRoute
} from './player-navigation'

describe('player-navigation', () => {
  it('creates a return target snapshot with explicit state', () => {
    expect(
      createPlayerReturnTarget(
        { pathname: '/series', search: '?q=1', hash: '#season-2' },
        { seriesId: 42 }
      )
    ).toEqual({
      pathname: '/series',
      search: '?q=1',
      hash: '#season-2',
      state: { seriesId: 42 }
    })
  })

  it('opens player after storing the current route as return target', () => {
    const navigate = vi.fn()
    const setPlayerReturnTarget = vi.fn()

    openPlayerFromRoute({
      location: { pathname: '/vod', search: '?genre=action', hash: '' },
      navigate,
      returnState: { channelId: 'vod_99' },
      setPlayerReturnTarget
    })

    expect(setPlayerReturnTarget).toHaveBeenCalledWith({
      pathname: '/vod',
      search: '?genre=action',
      hash: '',
      state: { channelId: 'vod_99' }
    })
    expect(navigate).toHaveBeenCalledWith('/player')
  })

  it('falls back to the provided path when there is no return target', () => {
    const navigate = vi.fn()

    navigateToPlayerReturnTarget({
      navigate,
      target: null,
      fallbackPath: '/home'
    })

    expect(navigate).toHaveBeenCalledWith('/home')
  })

  it('navigates back to the stored route and state', () => {
    const navigate = vi.fn()

    navigateToPlayerReturnTarget({
      navigate,
      target: {
        pathname: '/series',
        search: '?season=3',
        hash: '#episode-7',
        state: { selectedEpisodeId: 'ep-7' }
      }
    })

    expect(navigate).toHaveBeenCalledWith(
      {
        pathname: '/series',
        search: '?season=3',
        hash: '#episode-7'
      },
      { state: { selectedEpisodeId: 'ep-7' } }
    )
  })
})
