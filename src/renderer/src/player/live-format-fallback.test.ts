import { describe, expect, it } from 'vitest'
import { initialLiveFormatState, liveFormatFallbackNotice, stepLiveFormat } from './live-format-fallback'

const loading = (loadId: number) => ({ phase: 'loading' as const, loadId })
const failed = (loadId: number) => ({ phase: 'error' as const, loadId })
const playing = (loadId: number) => ({ phase: 'playing' as const, loadId })

describe('stepLiveFormat (F2-04)', () => {
  it('falls back once when the first load fails, and ignores the failed load from then on', () => {
    const start = initialLiveFormatState('ts')
    const step = stepLiveFormat(start, failed(1), 'm3u8')
    expect(step.fallbackTo).toBe('m3u8')
    expect(step.ignore).toBe(true)
    expect(step.state).toMatchObject({ format: 'm3u8', fellBack: true, replacedLoadId: 1 })

    // A late copy of the failed load's snapshot changes nothing.
    expect(stepLiveFormat(step.state, failed(1), 'ts')).toMatchObject({ fallbackTo: null, ignore: true })
  })

  it('does not fall back a second time; the reconnect policy takes the next failure', () => {
    const fellBack = stepLiveFormat(initialLiveFormatState('ts'), failed(1), 'm3u8').state
    const again = stepLiveFormat(fellBack, failed(2), 'ts')
    expect(again.fallbackTo).toBeNull()
    expect(again.ignore).toBe(false)
  })

  it('does not fall back once the channel has opened', () => {
    const opened = stepLiveFormat(initialLiveFormatState('ts'), playing(1), 'm3u8').state
    expect(opened.opened).toBe(true)
    expect(stepLiveFormat(opened, failed(1), 'm3u8').fallbackTo).toBeNull()
  })

  it('does nothing without an alternative or for a stream that has no live format', () => {
    expect(stepLiveFormat(initialLiveFormatState('ts'), failed(1), null).fallbackTo).toBeNull()
    expect(stepLiveFormat(initialLiveFormatState(null), failed(1), 'm3u8').fallbackTo).toBeNull()
    expect(stepLiveFormat(initialLiveFormatState('ts'), loading(1), 'm3u8')).toMatchObject({
      fallbackTo: null,
      ignore: false
    })
  })

  it('tells the viewer what happened, in Turkish', () => {
    expect(liveFormatFallbackNotice('ts', 'm3u8')).toBe('Kanal MPEG-TS biçiminde açılamadı; HLS ile deneniyor.')
  })
})
