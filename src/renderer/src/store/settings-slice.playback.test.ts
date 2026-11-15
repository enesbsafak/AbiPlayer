import { describe, expect, it } from 'vitest'
import { normalizeSettings } from './settings-slice'

describe('playback settings added for F2-04 and F2-15', () => {
  it('defaults to the automatic live format and the corner player off', () => {
    expect(normalizeSettings({})).toMatchObject({ liveStreamFormat: 'auto', keepPlayingInCorner: false })
  })

  it('keeps a known live format and drops anything else', () => {
    expect(normalizeSettings({ liveStreamFormat: 'ts' }).liveStreamFormat).toBe('ts')
    expect(normalizeSettings({ liveStreamFormat: 'm3u8' }).liveStreamFormat).toBe('m3u8')
    expect(normalizeSettings({ liveStreamFormat: 'rtmp' }).liveStreamFormat).toBe('auto')
    expect(normalizeSettings({ liveStreamFormat: 1 }).liveStreamFormat).toBe('auto')
  })

  it('keeps the experimental corner setting only as a boolean', () => {
    expect(normalizeSettings({ keepPlayingInCorner: true }).keepPlayingInCorner).toBe(true)
    expect(normalizeSettings({ keepPlayingInCorner: 'yes' }).keepPlayingInCorner).toBe(false)
  })
})
