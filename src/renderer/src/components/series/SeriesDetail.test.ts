import { createElement, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const xtream = vi.hoisted(() => ({
  getSeriesInfo: vi.fn(),
  buildSeriesUrl: vi.fn(() => 'http://example.test/series/1.mp4')
}))

vi.mock('@/services/xtream-api', () => ({ xtreamApi: xtream }))

import { useStore } from '@/store'
import { SeriesDetail } from './SeriesDetail'

const SERIES_INFO = {
  info: { name: 'Dizi' },
  seasons: [
    { season_number: 1, name: 'Sezon 1' },
    { season_number: 2, name: 'Sezon 2' }
  ],
  episodes: {
    '1': [{ id: '11', episode_num: 1, title: 'Bir' }],
    '2': [{ id: '21', episode_num: 1, title: 'İki' }]
  }
}

// Mirrors how SeriesPage wires the detail view: every season click is stored
// by the parent and handed back as `initialSeasonNumber`.
function Harness() {
  const [season, setSeason] = useState<number | undefined>(undefined)
  return createElement(SeriesDetail, {
    seriesId: 7,
    sourceId: 'src',
    initialSeasonNumber: season,
    onBack: () => {},
    onSeasonChange: setSeason,
    onPlayEpisode: () => {}
  })
}

beforeEach(() => {
  xtream.getSeriesInfo.mockResolvedValue(SERIES_INFO)
  useStore.setState({
    credentialsHydrated: true,
    getXtreamCredentials: () => ({ url: 'http://example.test', username: 'u', password: 'p' })
  })
})

afterEach(cleanup)

describe('SeriesDetail', () => {
  it('switches seasons without reloading the series', async () => {
    render(createElement(Harness))

    expect(await screen.findByText('E1. Bir')).toBeTruthy()
    expect(xtream.getSeriesInfo).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Sezon 2' }))

    expect(await screen.findByText('E1. İki')).toBeTruthy()
    expect(xtream.getSeriesInfo).toHaveBeenCalledTimes(1)
  })
})
