import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'
import { ChannelCard } from './ChannelCard'
import { VODCard } from '@/components/vod/VODCard'

const channel: Channel = {
  id: 'src_live_1',
  name: 'TRT 1',
  streamUrl: 'http://example.test/1.ts',
  sourceId: 'src',
  type: 'live'
}

const movie: Channel = {
  id: 'src_vod_9',
  name: 'Film',
  streamUrl: 'http://example.test/9.mp4',
  sourceId: 'src',
  type: 'vod'
}

afterEach(() => {
  cleanup()
  useStore.setState({ favoriteIds: new Set<string>() })
})

describe('ChannelCard favourite star', () => {
  it('updates when the card toggles it', () => {
    render(createElement(ChannelCard, { channel, onPlay: () => {} }))

    fireEvent.click(screen.getByRole('button', { name: 'Favorilere ekle' }))

    expect(useStore.getState().favoriteIds.has(channel.id)).toBe(true)
    expect(screen.getByRole('button', { name: 'Favorilerden çıkar' })).toBeTruthy()
  })

  it('updates when the favourite changes elsewhere', () => {
    render(createElement(ChannelCard, { channel, onPlay: () => {} }))

    act(() => {
      useStore.getState().toggleFavorite(channel.id)
    })

    expect(screen.getByRole('button', { name: 'Favorilerden çıkar' })).toBeTruthy()
  })
})

describe('favourite snapshot from the card', () => {
  it('is taken from the item the card shows, even when it is not in the catalog', () => {
    render(createElement(VODCard, { item: { ...movie, name: 'Arşivden Film' }, onPlay: () => {} }))

    fireEvent.click(screen.getByRole('button', { name: 'Favorilere ekle' }))

    expect(useStore.getState().favoriteSnapshots[movie.id]).toMatchObject({ id: movie.id, name: 'Arşivden Film' })
  })
})

describe('VODCard favourite toggle', () => {
  it('adds the film without starting playback', () => {
    let played = 0
    render(createElement(VODCard, { item: movie, onPlay: () => { played += 1 } }))

    fireEvent.click(screen.getByRole('button', { name: 'Favorilere ekle' }))

    expect(useStore.getState().favoriteIds.has(movie.id)).toBe(true)
    expect(played).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Film oynat' }))
    expect(played).toBe(1)
  })
})
