import { describe, expect, it } from 'vitest'
import {
  AUTO_VIDEO_QUALITY_ID,
  buildVideoQualityOptions,
  getActiveVideoQualityId,
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
        name: 'Festival Kopyasi',
        streamUrl: 'https://cdn.example.com/movie-cam.mp4'
      })
    ).toBe('CAM')
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

  it('converts between active level ids and hls level indices', () => {
    expect(getActiveVideoQualityId(2)).toBe(getVideoQualityId(2))
    expect(getActiveVideoQualityId(-1)).toBeNull()
    expect(getVideoQualityLevelIndex(getVideoQualityId(4))).toBe(4)
    expect(getVideoQualityLevelIndex('auto')).toBeNull()
  })
})
