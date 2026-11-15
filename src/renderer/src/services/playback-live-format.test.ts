import { describe, expect, it } from 'vitest'
import type { XtreamAuthResponse, XtreamLiveFormat } from '@/types/xtream'
import {
  AUTO_MPV_LIVE_FORMAT,
  decideLiveFormat,
  liveFormatFallback,
  resolveEngineStreamUrl,
  type LiveFormatSetting,
  type PlaybackEngineKind
} from './playback'

const BOTH: XtreamLiveFormat[] = ['m3u8', 'ts']
const HLS_ONLY: XtreamLiveFormat[] = ['m3u8']
const TS_ONLY: XtreamLiveFormat[] = ['ts']

describe('decideLiveFormat (F2-04)', () => {
  // engine, setting, allowed -> requested
  const table: Array<[PlaybackEngineKind, LiveFormatSetting, XtreamLiveFormat[], XtreamLiveFormat]> = [
    ['mpv', 'auto', BOTH, AUTO_MPV_LIVE_FORMAT],
    ['mpv', 'm3u8', BOTH, 'm3u8'],
    ['mpv', 'ts', BOTH, 'ts'],
    ['mpv', 'auto', TS_ONLY, 'ts'],
    ['mpv', 'm3u8', TS_ONLY, 'ts'],
    ['mpv', 'ts', HLS_ONLY, 'm3u8'],
    ['mpv', 'auto', HLS_ONLY, 'm3u8'],
    // The HTML5 engine plays live only through hls.js: HLS whatever the setting.
    ['html5', 'auto', BOTH, 'm3u8'],
    ['html5', 'm3u8', BOTH, 'm3u8'],
    ['html5', 'ts', BOTH, 'm3u8'],
    // ...unless the account does not allow it; a disallowed format is never asked for.
    ['html5', 'ts', TS_ONLY, 'ts']
  ]

  it.each(table)('%s, setting %s, allowed %j -> %s', (engine, setting, allowed, expected) => {
    expect(decideLiveFormat(engine, setting, allowed)).toBe(expected)
  })

  it('keeps HLS as the automatic choice for mpv (measured, see docs/olcumler)', () => {
    expect(AUTO_MPV_LIVE_FORMAT).toBe('m3u8')
  })
})

describe('liveFormatFallback', () => {
  it('tries the other format once when the account allows it and the format was chosen explicitly', () => {
    expect(liveFormatFallback('mpv', 'ts', BOTH, 'ts')).toBe('m3u8')
    expect(liveFormatFallback('mpv', 'm3u8', BOTH, 'm3u8')).toBe('ts')
  })

  it('never falls back to a format the account does not allow', () => {
    expect(liveFormatFallback('mpv', 'ts', TS_ONLY, 'ts')).toBeNull()
    expect(liveFormatFallback('mpv', 'm3u8', HLS_ONLY, 'm3u8')).toBeNull()
  })

  it('leaves the automatic choice and the HTML5 engine alone', () => {
    expect(liveFormatFallback('mpv', 'auto', BOTH, 'm3u8')).toBeNull()
    expect(liveFormatFallback('html5', 'ts', BOTH, 'm3u8')).toBeNull()
  })
})

describe('resolveEngineStreamUrl', () => {
  const credentials = { url: 'http://panel.test:8080', username: 'u', password: 'p' }
  const auth = (formats: string[]) =>
    ({ user_info: { allowed_output_formats: formats } }) as unknown as XtreamAuthResponse
  const state = (formats: string[]) => ({
    getXtreamCredentials: (sourceId: string) => (sourceId === 's' ? credentials : null),
    xtreamAuth: { s: auth(formats) }
  })
  const live = {
    target: { kind: 'live' as const, sourceId: 's', streamId: 7 },
    streamUrl: 'http://panel.test:8080/live/u/p/7.m3u8'
  }

  it('builds the live URL in the format decided for the engine', () => {
    expect(resolveEngineStreamUrl(live, 'mpv', 'ts', state(['m3u8', 'ts']))).toEqual({
      url: 'http://panel.test:8080/live/u/p/7.ts',
      format: 'ts',
      allowed: ['m3u8', 'ts']
    })
    expect(resolveEngineStreamUrl(live, 'html5', 'ts', state(['m3u8', 'ts'])).url).toBe(
      'http://panel.test:8080/live/u/p/7.m3u8'
    )
  })

  it('takes a fallback format only when the account allows it', () => {
    expect(resolveEngineStreamUrl(live, 'mpv', 'ts', state(['m3u8', 'ts']), 'm3u8').format).toBe('m3u8')
    expect(resolveEngineStreamUrl(live, 'mpv', 'm3u8', state(['m3u8']), 'ts').format).toBe('m3u8')
  })

  it('plays everything else, and a live channel without credentials, as resolved at the start', () => {
    const film = {
      target: { kind: 'movie' as const, sourceId: 's', streamId: 9, containerExtension: 'mkv' },
      streamUrl: 'http://panel.test:8080/movie/u/p/9.mkv'
    }
    expect(resolveEngineStreamUrl(film, 'mpv', 'ts', state(['ts']))).toEqual({
      url: film.streamUrl,
      format: null,
      allowed: []
    })
    const orphan = { ...live, target: { ...live.target, sourceId: 'gone' } }
    expect(resolveEngineStreamUrl(orphan, 'mpv', 'ts', state(['ts'])).url).toBe(live.streamUrl)
  })
})
