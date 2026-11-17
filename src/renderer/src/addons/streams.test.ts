import { afterEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { createPlayerSlice, type PlayerSlice } from '@/store/player-slice'
import { resolveStreamUrl, streamUrlContextFor } from '@/services/playback'
import { XtreamRequestError } from '@/services/xtream-errors'
import type { Channel } from '@/types/playlist'
import { addonTarget, mediaKey } from '../../../shared/playback'
import { defined } from '../../../shared/checked'
import type { AddonStream } from './client'
import {
  chooseAddonStream,
  chosenAddonStreamUrl,
  forgetAddonStreams,
  hasChosenAddonStream,
  registerAddonStreamUrl
} from './stream-registry'
import {
  addonStreamPreferenceFor,
  collectAddonStreams,
  forgetAddonStreamPreferences,
  pickPreferredCandidate,
  rememberAddonStreamChoice,
  streamAddonsFor,
  type AddonStreamResult
} from './streams'
import { CATALOG_BASE, SECRET_SEGMENT, STREAM_BASE, STREAM_URL, catalogSource, streamSource } from './testing/fixtures'

const film = addonTarget({ sourceId: 'ek', contentType: 'movie', metaId: 'tt0000001' })
const episode = addonTarget({ sourceId: 'ek', contentType: 'series', metaId: 'tt0000002', videoId: 'tt0000002:1:3' })
const filmChannel: Channel = { id: 'ek_vod_populer/tt0000001', name: 'Örnek Film', streamUrl: '', sourceId: 'ek', type: 'vod', addonMetaId: 'tt0000001' }

function stream(overrides: Partial<AddonStream> = {}): AddonStream {
  return { url: STREAM_URL, name: '1080p', description: 'Örnek dosya', bingeGroup: 'grup-1080', filename: null, videoSize: null, notWebReady: false, ...overrides }
}

afterEach(() => {
  forgetAddonStreams()
  forgetAddonStreamPreferences()
})

describe('which add-ons are asked', () => {
  it('asks stream add-ons whose type and id prefix fit, whichever add-on listed the item', () => {
    const sources = [catalogSource(), streamSource(), streamSource({ id: 'ak2', url: undefined }), { id: 'xt', name: 'Panel', type: 'xtream' as const, addedAt: 1 }]
    expect(streamAddonsFor(sources, film).map((source) => source.id)).toEqual(['ak'])
    expect(streamAddonsFor(sources, addonTarget({ sourceId: 'ek', contentType: 'movie', metaId: 'yt:1' }))).toEqual([])
  })
})

describe('collectAddonStreams', () => {
  it('asks every stream add-on in parallel and reports each as it answers', async () => {
    const second = streamSource({ id: 'ak2', name: 'İkinci Akış', url: `${STREAM_BASE}-2` })
    const third = streamSource({ id: 'ak3', name: 'Üçüncü Akış', url: `${STREAM_BASE}-3` })
    const order: string[] = []
    const fetchStreams = vi.fn(async (base: string, type: string, videoId: string) => {
      expect([type, videoId]).toEqual(['series', 'tt0000002:1:3'])
      if (base === STREAM_BASE) {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return [stream(), stream({ url: `${STREAM_BASE}/oynat/2.mp4`, name: '720p', bingeGroup: null, notWebReady: true })]
      }
      if (base === second.url) return []
      throw new XtreamRequestError('http', 'Sunucu isteği reddetti (HTTP 500).', { status: 500, host: 'akis.addon.example' })
    })
    const seen: AddonStreamResult[] = []
    const results = await collectAddonStreams(episode, {
      sources: [catalogSource(), streamSource(), second, third],
      fetchStreams,
      onResult: (result) => {
        order.push(result.sourceId)
        seen.push(result)
      }
    })
    expect(fetchStreams).toHaveBeenCalledTimes(3)
    expect(results.map((result) => [result.sourceId, result.status])).toEqual([
      ['ak', 'candidates'],
      ['ak2', 'empty'],
      ['ak3', 'failed']
    ])
    expect(order[0]).not.toBe('ak')
    expect(seen).toHaveLength(3)

    const first = defined(results[0])
    if (first.status !== 'candidates') throw new Error('expected candidates')
    expect(first.addonName).toBe('Örnek Akış')
    expect(first.candidates[0]).toEqual({
      handle: expect.any(String),
      sourceId: 'ak',
      addonName: 'Örnek Akış',
      name: '1080p',
      description: 'Örnek dosya',
      bingeGroup: 'grup-1080',
      filename: null,
      videoSize: null,
      notWebReady: false
    })
    expect(first.candidates[1]).toMatchObject({ name: '720p', notWebReady: true })
    expect(defined(results[2])).toMatchObject({ status: 'failed', error: { kind: 'http', status: 500 } })

    // Nothing handed to the UI holds a URL or the add-on's settings.
    const shown = JSON.stringify(results)
    expect(shown).not.toContain(SECRET_SEGMENT)
    expect(shown).not.toContain('://')
  })

  it('gives up on an add-on after its time limit, without holding the others back', async () => {
    const slow = streamSource({ id: 'yavas', url: `${STREAM_BASE}-yavas` })
    const results = await collectAddonStreams(film, {
      sources: [streamSource(), slow],
      timeoutMs: 20,
      fetchStreams: (base, _type, _id, options) =>
        base === STREAM_BASE
          ? Promise.resolve([stream()])
          : new Promise((_resolve, reject) =>
              options.signal?.addEventListener('abort', () => reject(new XtreamRequestError('aborted', 'İstek iptal edildi')))
            )
    })
    expect(results.map((result) => result.status)).toEqual(['candidates', 'failed'])
    expect(defined(results[1])).toMatchObject({ error: { kind: 'timeout', retryable: true } })
  })

  it('reports add-ons that had not answered as cancelled when the picker closes', async () => {
    const controller = new AbortController()
    const pending = collectAddonStreams(film, {
      sources: [streamSource()],
      signal: controller.signal,
      fetchStreams: (_base, _type, _id, options) =>
        new Promise((_resolve, reject) =>
          options.signal?.addEventListener('abort', () => reject(new XtreamRequestError('aborted', 'İstek iptal edildi')))
        )
    })
    controller.abort()
    expect(await pending).toEqual([
      { sourceId: 'ak', addonName: 'Örnek Akış', status: 'failed', error: expect.objectContaining({ kind: 'aborted' }) }
    ])
  })

  it('resolves to nothing when no add-on gives streams', async () => {
    expect(await collectAddonStreams(film, { sources: [catalogSource()] })).toEqual([])
  })
})

describe('stream registry', () => {
  it('turns a handle into the URL only for the target it was offered for', () => {
    const handle = registerAddonStreamUrl(film, STREAM_URL)
    expect(handle).not.toContain('http')
    expect(chooseAddonStream(episode, handle)).toBe(false)
    expect(chooseAddonStream(film, 'bilinmeyen')).toBe(false)
    expect(hasChosenAddonStream(film)).toBe(false)
    expect(chooseAddonStream(film, handle)).toBe(true)
    expect(chosenAddonStreamUrl(film)).toBe(STREAM_URL)
  })

  it('forgets a source’s choices', () => {
    chooseAddonStream(film, registerAddonStreamUrl(film, STREAM_URL))
    forgetAddonStreams('baska')
    expect(chosenAddonStreamUrl(film)).toBe(STREAM_URL)
    forgetAddonStreams('ek')
    expect(chosenAddonStreamUrl(film)).toBeNull()
  })

  it('feeds resolveStreamUrl, which has nothing for an add-on target without a choice', () => {
    expect(resolveStreamUrl(film, streamUrlContextFor(film, {}, { fallbackUrl: 'http://cdn.example/eski.mp4' }))).toBeNull()
    chooseAddonStream(film, registerAddonStreamUrl(film, STREAM_URL))
    expect(resolveStreamUrl(film, streamUrlContextFor(film, {}))).toBe(STREAM_URL)
  })
})

describe('playAddonStream', () => {
  const createPlayer = () => create<PlayerSlice>()((...args) => createPlayerSlice(...args))

  it('starts the target with the picked candidate and keeps it for a reload', () => {
    const store = createPlayer()
    const handle = registerAddonStreamUrl(film, STREAM_URL)
    store.getState().playAddonStream({ target: film, channel: filmChannel, handle })
    const playback = defined(store.getState().currentPlayback)
    expect(playback).toMatchObject({ target: film, mediaKey: mediaKey(film), streamUrl: STREAM_URL })
    expect(store.getState().pendingResume).toMatchObject({ mediaKey: mediaKey(film) })
    store.getState().reloadPlayback()
    expect(store.getState().currentPlayback?.streamUrl).toBe(STREAM_URL)
    expect(store.getState().currentPlayback?.playbackId).not.toBe(playback.playbackId)
  })

  it('fails like an unplayable item with an unknown handle, or without a choice', () => {
    const store = createPlayer()
    store.getState().playAddonStream({ target: film, channel: filmChannel, handle: 'bilinmeyen' })
    expect(store.getState().currentPlayback).toBeNull()
    expect(store.getState().playerError).toBeTruthy()
    store.getState().playChannel(filmChannel)
    expect(store.getState().currentPlayback).toBeNull()
  })
})

describe('remembered choice', () => {
  it('picks the same add-on and binge group for the next episode', () => {
    const next = addonTarget({ sourceId: 'ek', contentType: 'series', metaId: 'tt0000002', videoId: 'tt0000002:1:4' })
    const candidates = [
      { handle: 'a', sourceId: 'ak2', addonName: 'B', name: null, description: null, bingeGroup: 'grup-1080', filename: null, videoSize: null, notWebReady: false },
      { handle: 'b', sourceId: 'ak', addonName: 'A', name: null, description: null, bingeGroup: 'grup-720', filename: null, videoSize: null, notWebReady: false },
      { handle: 'c', sourceId: 'ak', addonName: 'A', name: null, description: null, bingeGroup: 'grup-1080', filename: null, videoSize: null, notWebReady: false }
    ]
    expect(pickPreferredCandidate(candidates, addonStreamPreferenceFor(next))).toBeNull()
    rememberAddonStreamChoice(episode, defined(candidates[2]))
    expect(addonStreamPreferenceFor(next)).toEqual({ sourceId: 'ak', bingeGroup: 'grup-1080' })
    expect(pickPreferredCandidate(candidates, addonStreamPreferenceFor(next))?.handle).toBe('c')
    expect(pickPreferredCandidate(candidates, { sourceId: 'ak', bingeGroup: null })).toBeNull()
    expect(JSON.stringify(addonStreamPreferenceFor(next))).not.toContain(CATALOG_BASE)
  })
})
