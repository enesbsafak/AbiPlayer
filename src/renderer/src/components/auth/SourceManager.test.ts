import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category, Channel, PlaylistSource } from '@/types/playlist'

const m3u = vi.hoisted(() => ({
  fetchAndParseM3U: vi.fn(),
  parseM3U: vi.fn()
}))

vi.mock('@/services/m3u-parser', () => m3u)

import { useStore } from '@/store'
import { catalog } from '@/catalog/catalog-store'
import { m3uPlaylistToReplacement } from '@/catalog/convert'
import { SourceManager } from './SourceManager'

function source(id: string, name: string): PlaylistSource {
  return { id, name, type: 'm3u_url', url: `http://example.test/${id}.m3u`, addedAt: 1 }
}

function channel(id: string, sourceId: string): Channel {
  return { id, name: id, streamUrl: `http://example.test/${id}.ts`, sourceId, type: 'live' }
}

function category(id: string, sourceId: string): Category {
  return { id, name: id, sourceId, type: 'live' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

function liveIds(sourceId: string): string[] {
  return catalog.getItems(sourceId, 'live').map((item) => item.id)
}

function liveCategoryIds(sourceId: string): string[] {
  return catalog.getCategories(sourceId, 'live').map((item) => item.id)
}

beforeEach(() => {
  catalog.reset()
  useStore.setState({
    sources: [source('a', 'Liste A'), source('b', 'Liste B')],
    activeSourceId: 'a',
    hiddenCategoryIds: new Set()
  })
  const { replaceSourceCatalog } = useStore.getState()
  replaceSourceCatalog('a', m3uPlaylistToReplacement({ channels: [channel('a1', 'a')], categories: [category('ca', 'a')] }))
  replaceSourceCatalog('b', m3uPlaylistToReplacement({ channels: [channel('b1', 'b')], categories: [] }))
})

afterEach(() => {
  cleanup()
  catalog.reset()
  useStore.setState({ sources: [], activeSourceId: null, hiddenCategoryIds: new Set() })
})

describe('SourceManager refresh', () => {
  it('keeps the old catalog when fetching the new one fails', async () => {
    m3u.fetchAndParseM3U.mockRejectedValue(new TypeError('Failed to fetch'))
    render(createElement(SourceManager))

    fireEvent.click(screen.getByRole('button', { name: 'Liste A kaynağını yenile' }))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Sunucuya ulaşılamadı. İnternet bağlantınızı ve sunucu adresini kontrol edin.'
    )
    expect(liveIds('a')).toEqual(['a1'])
    expect(liveIds('b')).toEqual(['b1'])
    expect(liveCategoryIds('a')).toEqual(['ca'])
  })

  it('swaps the catalog once the new one has arrived', async () => {
    m3u.fetchAndParseM3U.mockResolvedValue({
      channels: [channel('a2', 'a')],
      categories: [category('ca2', 'a')]
    })
    render(createElement(SourceManager))

    fireEvent.click(screen.getByRole('button', { name: 'Liste A kaynağını yenile' }))

    await waitFor(() => {
      expect(liveIds('a')).toEqual(['a2'])
    })
    expect(liveIds('b')).toEqual(['b1'])
    expect(liveCategoryIds('a')).toEqual(['ca2'])
    expect(catalog.getStatus('a', 'live')).toMatchObject({ complete: true })
  })

  it('keeps the hidden categories of the refreshed source', async () => {
    useStore.setState({ hiddenCategoryIds: new Set(['ca']) })
    m3u.fetchAndParseM3U.mockResolvedValue({ channels: [channel('a2', 'a')], categories: [category('ca', 'a')] })
    render(createElement(SourceManager))

    fireEvent.click(screen.getByRole('button', { name: 'Liste A kaynağını yenile' }))

    await waitFor(() => expect(liveIds('a')).toEqual(['a2']))
    expect(useStore.getState().hiddenCategoryIds).toEqual(new Set(['ca']))
  })

  it('drops a refresh that finishes after its source was deleted', async () => {
    const pending = deferred<{ channels: Channel[]; categories: Category[] }>()
    m3u.fetchAndParseM3U.mockReturnValue(pending.promise)
    render(createElement(SourceManager))

    fireEvent.click(screen.getByRole('button', { name: 'Liste A kaynağını yenile' }))
    // Deleted and added back under the same id while the download runs.
    useStore.getState().removeSource('a')
    useStore.getState().removeSourceCatalog('a')
    useStore.getState().addSource(source('a', 'Liste A'))

    await act(async () => {
      pending.resolve({ channels: [channel('ghost', 'a')], categories: [] })
    })

    expect(liveIds('a')).toEqual([])
    expect(catalog.getStatus('a', 'live')).toBeNull()
  })

  it('keeps the other spinner when one of two refreshes finishes', async () => {
    const first = deferred<{ channels: Channel[]; categories: Category[] }>()
    const second = deferred<{ channels: Channel[]; categories: Category[] }>()
    m3u.fetchAndParseM3U.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(createElement(SourceManager))

    const refreshA = screen.getByRole('button', { name: 'Liste A kaynağını yenile' })
    const refreshB = screen.getByRole('button', { name: 'Liste B kaynağını yenile' })
    fireEvent.click(refreshA)
    fireEvent.click(refreshB)
    expect(refreshA).toHaveProperty('disabled', true)
    expect(refreshB).toHaveProperty('disabled', true)

    await act(async () => {
      first.resolve({ channels: [], categories: [] })
    })

    expect(refreshA).toHaveProperty('disabled', false)
    expect(refreshB).toHaveProperty('disabled', true)

    await act(async () => {
      second.resolve({ channels: [], categories: [] })
    })
    expect(refreshB).toHaveProperty('disabled', false)
  })
})

describe('SourceManager removal', () => {
  it('asks before deleting and does nothing on cancel', () => {
    render(createElement(SourceManager))

    fireEvent.click(screen.getByRole('button', { name: 'Liste A kaynağını sil' }))
    expect(useStore.getState().sources).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(useStore.getState().sources).toHaveLength(2)
  })

  it('deletes the source after confirmation', async () => {
    render(createElement(SourceManager))

    fireEvent.click(screen.getByRole('button', { name: 'Liste A kaynağını sil' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sil' }))

    await waitFor(() => {
      expect(useStore.getState().sources.map((s) => s.id)).toEqual(['b'])
    })
    expect(liveIds('a')).toEqual([])
    expect(catalog.getStatus('a', 'live')).toBeNull()
    expect(liveIds('b')).toEqual(['b1'])
  })
})
