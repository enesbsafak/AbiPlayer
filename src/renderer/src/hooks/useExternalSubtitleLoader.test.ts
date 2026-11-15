import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return {
    ...actual,
    pickAndReadFile: vi.fn(),
    mpvAddSubtitleFile: vi.fn()
  }
})

import { mpvAddSubtitleFile, pickAndReadFile } from '@/services/platform'
import {
  SUBTITLE_FILE_ADD_ERROR,
  SUBTITLE_FILE_EMPTY_ERROR,
  SUBTITLE_FILE_READ_ERROR,
  useExternalSubtitleLoader
} from './useExternalSubtitleLoader'

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nMerhaba\n'

describe('useExternalSubtitleLoader', () => {
  beforeEach(() => {
    useStore.getState().stopPlayback()
    useStore.getState().setPlaybackEngine('html5')
  })

  afterEach(() => {
    // Without vitest globals, testing-library cannot register its own cleanup.
    cleanup()
  })

  async function load() {
    const { result } = renderHook(() => useExternalSubtitleLoader())
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.load()
    })
    return { outcome, error: result.current.error }
  }

  it('reports a file that could not be read', async () => {
    vi.mocked(pickAndReadFile).mockRejectedValue(new Error('File too large'))
    expect(await load()).toEqual({ outcome: 'failed', error: SUBTITLE_FILE_READ_ERROR })
  })

  it('reports a file without any usable subtitle line', async () => {
    vi.mocked(pickAndReadFile).mockResolvedValue({ path: 'C:/a.srt', content: 'bozuk' })
    expect(await load()).toEqual({ outcome: 'failed', error: SUBTITLE_FILE_EMPTY_ERROR })
    expect(useStore.getState().currentSubtitleTrack).toBeNull()
  })

  it('reports mpv refusing the file', async () => {
    useStore.getState().setPlaybackEngine('mpv')
    vi.mocked(pickAndReadFile).mockResolvedValue({ path: 'C:/a.srt', content: SRT })
    vi.mocked(mpvAddSubtitleFile).mockResolvedValue(null)
    expect(await load()).toEqual({ outcome: 'failed', error: SUBTITLE_FILE_ADD_ERROR })
  })

  it('stays quiet when the picker is cancelled', async () => {
    vi.mocked(pickAndReadFile).mockResolvedValue(null)
    expect(await load()).toEqual({ outcome: 'cancelled', error: null })
  })

  it('loads a good file as the viewer\u2019s own choice', async () => {
    vi.mocked(pickAndReadFile).mockResolvedValue({ path: 'C:/a.srt', content: SRT })
    expect(await load()).toEqual({ outcome: 'loaded', error: null })
    expect(useStore.getState().currentSubtitleTrack).toBe('external')
    expect(useStore.getState().isSubtitleTrackUserChoice).toBe(true)
    expect(useStore.getState().subtitleCues).toHaveLength(1)
  })

  it('hands the file to mpv when mpv is playing', async () => {
    useStore.getState().setPlaybackEngine('mpv')
    vi.mocked(pickAndReadFile).mockResolvedValue({ path: 'C:/a.srt', content: SRT })
    vi.mocked(mpvAddSubtitleFile).mockResolvedValue(4)
    expect(await load()).toEqual({ outcome: 'loaded', error: null })
    expect(useStore.getState().currentSubtitleTrack).toBe('mpv-s:4')
  })

  // P5: mpv holds the file for one load; the item remembers it for the next.
  it('remembers the file given to mpv for the item being played', async () => {
    useStore.getState().playChannel({ id: 'f', name: 'Film', streamUrl: 'https://e.test/movie/f.mkv', sourceId: 's', type: 'vod' })
    useStore.getState().setPlaybackEngine('mpv')
    vi.mocked(pickAndReadFile).mockResolvedValue({ path: 'C:/a.srt', content: SRT })
    vi.mocked(mpvAddSubtitleFile).mockResolvedValue(4)
    await load()
    expect(useStore.getState().externalSubtitle).toEqual({
      mediaKey: useStore.getState().currentPlayback!.mediaKey,
      path: 'C:/a.srt',
      trackId: 'mpv-s:4'
    })
  })
})
