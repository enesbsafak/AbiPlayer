import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import { chosenAddonStreamUrl, forgetAddonStreams } from '@/addons/stream-registry'
import { forgetAddonStreamPreferences, rememberAddonStreamChoice } from '@/addons/streams'
import { addonResourceUrl } from '@/addons/address'
import {
  SECRET_SEGMENT,
  STREAM_BASE,
  STREAM_URL,
  catalogSource,
  jsonResponse,
  routeFetch,
  streamSource
} from '@/addons/testing/fixtures'
import type { Channel } from '@/types/playlist'
import { addonTarget, mediaKey, type AddonPlaybackTarget } from '../../../../shared/playback'
import { useAddonPlayback, type AddonPlayRequest } from './useAddonPlayback'

const film = addonTarget({ sourceId: 'ek', contentType: 'movie', metaId: 'tt0000001' })
const filmChannel: Channel = { id: 'ek_vod_populer/tt0000001', name: 'Örnek Film', streamUrl: '', sourceId: 'ek', type: 'vod', addonMetaId: 'tt0000001' }
const episode = (number: number) =>
  addonTarget({ sourceId: 'ek', contentType: 'series', metaId: 'tt0000002', videoId: `tt0000002:1:${number}` })
const episodeChannel: Channel = { id: 'ek_episode_x', name: 'Örnek Dizi - S1E2 - Bölüm', streamUrl: '', sourceId: 'ek', type: 'vod' }

function streamsUrl(target: AddonPlaybackTarget): string {
  return addonResourceUrl(STREAM_BASE, 'stream', target.contentType, target.videoId)
}

const STREAMS = {
  streams: [
    {
      url: STREAM_URL,
      name: 'Örnek\n1080p',
      title: 'Örnek.Film.2021.1080p\n👤 12',
      behaviorHints: { bingeGroup: 'grup-1080', videoSize: 1.5 * 1024 ** 3 }
    },
    { url: `${STREAM_BASE}/oynat/2.mp4`, name: '720p', behaviorHints: { bingeGroup: 'grup-720' } },
    // Not playable here: dropped from the candidates.
    { infoHash: '0123456789abcdef0123456789abcdef01234567', name: 'Torrent' }
  ]
}

let onStarted = vi.fn()

function Harness({ request }: { request: Omit<AddonPlayRequest, 'onStarted'> }) {
  const playback = useAddonPlayback()
  return (
    <>
      <button type="button" onClick={() => playback.play({ ...request, onStarted })}>
        İzle
      </button>
      {playback.picker}
    </>
  )
}

function renderHarness(request: Omit<AddonPlayRequest, 'onStarted'>) {
  return render(
    <MemoryRouter>
      <Harness request={request} />
    </MemoryRouter>
  )
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

beforeEach(() => {
  onStarted = vi.fn()
  useStore.setState({
    sources: [catalogSource(), streamSource()],
    credentialsHydrated: true,
    currentPlayback: null,
    currentChannel: null,
    playerError: null
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  forgetAddonStreams()
  forgetAddonStreamPreferences()
  useStore.setState({ sources: [], currentPlayback: null, currentChannel: null, playerError: null })
})

describe('choosing a stream', () => {
  it('asks the stream add-ons, lists their candidates as written and plays the one chosen', async () => {
    vi.stubGlobal('fetch', routeFetch({ [streamsUrl(film)]: () => jsonResponse(STREAMS) }))
    renderHarness({ target: film, channel: filmChannel })

    fireEvent.click(screen.getByRole('button', { name: 'İzle' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Örnek Film')
    const first = await screen.findByRole('button', { name: /1080p/ })
    expect(first.textContent).toContain('Örnek.Film.2021.1080p')
    expect(first.textContent).toContain('1,5 GB')
    expect(screen.queryByText('Torrent')).toBeNull()
    // The add-on's name and host only: never its address or a stream URL.
    expect(dialog.innerHTML).not.toContain(SECRET_SEGMENT)

    fireEvent.click(first)
    expect(useStore.getState().currentPlayback?.mediaKey).toBe(mediaKey(film))
    expect(useStore.getState().currentChannel).toBe(filmChannel)
    expect(chosenAddonStreamUrl(film)).toBe(STREAM_URL)
    expect(onStarted).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()

    // Chosen in this session: the same film plays again without asking.
    fireEvent.click(screen.getByRole('button', { name: 'İzle' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onStarted).toHaveBeenCalledTimes(2)
  })

  it('moves between candidates with the arrow keys and closes on Escape, giving the focus back', async () => {
    vi.stubGlobal('fetch', routeFetch({ [streamsUrl(film)]: () => jsonResponse(STREAMS) }))
    renderHarness({ target: film, channel: filmChannel })
    const opener = screen.getByRole('button', { name: 'İzle' })
    opener.focus()
    fireEvent.click(opener)

    const first = await screen.findByRole('button', { name: /1080p/ })
    await waitFor(() => expect(document.activeElement).toBe(first))
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /720p/ }))

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(opener))
    expect(useStore.getState().currentPlayback).toBeNull()
  })

  it('says so when no installed add-on gives streams', async () => {
    useStore.setState({ sources: [catalogSource()] })
    renderHarness({ target: film, channel: filmChannel })
    fireEvent.click(screen.getByRole('button', { name: 'İzle' }))
    expect(await screen.findByText('Yayın sağlayan bir eklenti kurulu değil')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Kaynak ayarlarına git' })).toBeTruthy()
  })

  it('names an add-on that refused, and offers a retry when every add-on failed', async () => {
    const fetch = routeFetch({ [streamsUrl(film)]: () => new Response('', { status: 403 }) })
    vi.stubGlobal('fetch', fetch)
    renderHarness({ target: film, channel: filmChannel })
    fireEvent.click(screen.getByRole('button', { name: 'İzle' }))

    expect(await screen.findByText('Eklentilerin hiçbiri yanıt vermedi')).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).toContain('Eklenti bu adresi kabul etmedi')
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar Dene' }))
    await waitFor(() => expect(fetch.calls).toHaveLength(2))
  })

  it('plays the next episode by itself with the add-on and release chosen for the previous one', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({ [streamsUrl(episode(2))]: () => jsonResponse(STREAMS) })
    )
    rememberAddonStreamChoice(episode(1), {
      handle: 'eski',
      sourceId: 'ak',
      addonName: 'Örnek Akış',
      name: '1080p',
      description: null,
      bingeGroup: 'grup-1080',
      filename: null,
      videoSize: null,
      notWebReady: false
    })
    renderHarness({ target: episode(2), channel: episodeChannel })
    fireEvent.click(screen.getByRole('button', { name: 'İzle' }))

    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1))
    expect(chosenAddonStreamUrl(episode(2))).toBe(STREAM_URL)
    expect(useStore.getState().currentPlayback?.mediaKey).toBe(mediaKey(episode(2)))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the candidates when the remembered release is not offered again', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({ [streamsUrl(episode(2))]: () => jsonResponse({ streams: [STREAMS.streams[1]] }) })
    )
    rememberAddonStreamChoice(episode(1), {
      handle: 'eski',
      sourceId: 'ak',
      addonName: 'Örnek Akış',
      name: '1080p',
      description: null,
      bingeGroup: 'grup-1080',
      filename: null,
      videoSize: null,
      notWebReady: false
    })
    renderHarness({ target: episode(2), channel: episodeChannel })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'İzle' }))
    })
    expect(await screen.findByRole('button', { name: /720p/ })).toBeTruthy()
    expect(onStarted).not.toHaveBeenCalled()
  })
})
