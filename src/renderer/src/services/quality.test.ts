import { describe, expect, it } from 'vitest'
import {
  AUTO_VIDEO_QUALITY_ID,
  buildMpvVideoQualityOptions,
  buildVideoQualityOptions,
  getActiveMpvVideoQualityId,
  getActiveVideoQualityId,
  getMpvVideoQualityId,
  getMpvVideoTrackId,
  getVideoQualityId,
  getVideoQualityLevelIndex,
  inferContentQualityLabel
} from './quality'

describe('quality', () => {
  it('infers a quality badge from common content labels', () => {
    expect(
      inferContentQualityLabel({
        name: 'Aksiyon Gecesi 1080p BluRay',
        streamUrl: 'https://cdn.example.com/movie.mp4'
      })
    ).toBe('1080p')

    expect(
      inferContentQualityLabel({
        name: 'TRT 1 HD',
        streamUrl: 'https://cdn.example.com/live/channel.m3u8'
      })
    ).toBe('720p')

    expect(
      inferContentQualityLabel({
        name: 'Festival Kopyasi CAM',
        streamUrl: 'https://cdn.example.com/movie.mp4'
      })
    ).toBe('CAM')

    // streamUrl should NOT be used for quality inference (prevents false positives from stream IDs)
    expect(
      inferContentQualityLabel({
        name: 'TRT 1',
        streamUrl: 'https://cdn.example.com/live/user/pass/1440.m3u8'
      })
    ).toBeNull()
  })

  it('builds stable HLS quality options with auto mode first', () => {
    const options = buildVideoQualityOptions([
      { height: 1080, bitrate: 5_600_000, name: 'Full HD' },
      { height: 720, bitrate: 2_400_000 }
    ])

    expect(options).toEqual([
      { id: AUTO_VIDEO_QUALITY_ID, label: 'Otomatik', shortLabel: 'Oto', auto: true },
      {
        id: getVideoQualityId(0),
        label: '1080p · 5.6 Mbps',
        shortLabel: '1080p',
        bitrate: 5_600_000,
        height: 1080
      },
      {
        id: getVideoQualityId(1),
        label: '720p · 2.4 Mbps',
        shortLabel: '720p',
        bitrate: 2_400_000,
        height: 720
      }
    ])
  })

  it('builds mpv quality options from video track metadata', () => {
    const options = buildMpvVideoQualityOptions([
      { id: 4, height: 2160, width: 3840, bitrate: 15_000_000, name: 'UHD' },
      { id: 2, height: 1080, bitrate: 5_000_000 }
    ])

    expect(options).toEqual([
      { id: AUTO_VIDEO_QUALITY_ID, label: 'Otomatik', shortLabel: 'Oto', auto: true },
      {
        id: getMpvVideoQualityId(4),
        label: '4K · 15 Mbps',
        shortLabel: '4K',
        bitrate: 15_000_000,
        height: 2160
      },
      {
        id: getMpvVideoQualityId(2),
        label: '1080p · 5.0 Mbps',
        shortLabel: '1080p',
        bitrate: 5_000_000,
        height: 1080
      }
    ])
  })

  it('converts between active quality ids and hls/mpv identifiers', () => {
    expect(getActiveVideoQualityId(2)).toBe(getVideoQualityId(2))
    expect(getActiveVideoQualityId(-1)).toBeNull()
    expect(getVideoQualityLevelIndex(getVideoQualityId(4))).toBe(4)
    expect(getVideoQualityLevelIndex('auto')).toBeNull()

    expect(getActiveMpvVideoQualityId(6)).toBe(getMpvVideoQualityId(6))
    expect(getActiveMpvVideoQualityId(null)).toBeNull()
    expect(getMpvVideoTrackId(getMpvVideoQualityId(3))).toBe(3)
    expect(getMpvVideoTrackId('auto')).toBeNull()
  })
})
