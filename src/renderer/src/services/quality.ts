import type { Channel, EpisodeInfo } from '@/types/playlist'
import type { VideoQualityOption } from '@/types/player'

export const AUTO_VIDEO_QUALITY_ID = 'auto'
export const HLS_VIDEO_QUALITY_PREFIX = 'hls-v:'
export const MPV_VIDEO_QUALITY_PREFIX = 'mpv-v:'

interface QualityMetadataSource {
  name?: string
  streamUrl?: string
  group?: string
  categoryName?: string
  containerExtension?: string
}

interface VideoLevelLike {
  bitrate?: number
  height?: number
  id?: number
  name?: string
  width?: number
}

const QUALITY_RULES = [
  { label: 'CAM', patterns: [/\b(?:hdcam|camrip|cam|telesync|tsrip|ts)\b/i] },
  { label: '4K', patterns: [/\b(?:2160p|4k|uhd|ultra[\s._-]*hd)\b/i] },
  { label: '1440p', patterns: [/\b(?:1440p|qhd)\b/i] },
  { label: '1080p', patterns: [/\b(?:1080p|fhd|full[\s._-]*hd)\b/i] },
  { label: '900p', patterns: [/\b900p\b/i] },
  { label: '720p', patterns: [/\b720p\b/i, /(?:^|[\s._-])hd(?:$|[\s._-])/i] },
  { label: '576p', patterns: [/\b576p\b/i] },
  { label: 'SD', patterns: [/\b(?:480p|sd)\b/i] },
  { label: '360p', patterns: [/\b360p\b/i] }
] as const

function normalizeTextParts(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
}

function inferResolutionFromDimensions(height?: number, width?: number): string | null {
  const maxDimension = Math.max(height || 0, width || 0)

  if (maxDimension >= 2160 || (height || 0) >= 2000) return '4K'
  if (maxDimension >= 1440 || (height || 0) >= 1400) return '1440p'
  if (maxDimension >= 1080 || (height || 0) >= 1000) return '1080p'
  if (maxDimension >= 720 || (height || 0) >= 700) return '720p'
  if (maxDimension >= 576 || (height || 0) >= 560) return '576p'
  if (maxDimension >= 480 || (height || 0) >= 460) return '480p'
  if (maxDimension >= 360 || (height || 0) >= 340) return '360p'

  return null
}

function formatBitrate(bitrate?: number): string | null {
  if (!bitrate || bitrate <= 0) return null

  const mbps = bitrate / 1_000_000
  if (mbps >= 10) return `${mbps.toFixed(0)} Mbps`
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`

  return `${Math.round(bitrate / 1000)} Kbps`
}

export function inferContentQualityLabel(
  source: QualityMetadataSource | Channel | EpisodeInfo | null | undefined
): string | null {
  if (!source) return null

  // Only use name and containerExtension — group/categoryName often contain
  // marketing labels like "2K" or "HD" that don't reflect actual resolution
  const haystack = normalizeTextParts([
    source.name,
    source.containerExtension
  ])

  if (!haystack) return null

  for (const rule of QUALITY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) return rule.label
  }

  return null
}

export function getVideoQualityId(levelIndex: number): string {
  return `${HLS_VIDEO_QUALITY_PREFIX}${levelIndex}`
}

export function getMpvVideoQualityId(trackId: number): string {
  return `${MPV_VIDEO_QUALITY_PREFIX}${trackId}`
}

export function getVideoQualityLevelIndex(qualityId: string | null | undefined): number | null {
  if (!qualityId?.startsWith(HLS_VIDEO_QUALITY_PREFIX)) return null

  const parsed = Number.parseInt(qualityId.replace(HLS_VIDEO_QUALITY_PREFIX, ''), 10)
  return Number.isNaN(parsed) ? null : parsed
}

export function getMpvVideoTrackId(qualityId: string | null | undefined): number | null {
  if (!qualityId?.startsWith(MPV_VIDEO_QUALITY_PREFIX)) return null

  const parsed = Number.parseInt(qualityId.replace(MPV_VIDEO_QUALITY_PREFIX, ''), 10)
  return Number.isNaN(parsed) ? null : parsed
}

export function formatVideoQualityLabel(level: VideoLevelLike): string {
  const inferredFromName = inferContentQualityLabel({ name: level.name })
  const inferredFromDimensions = inferResolutionFromDimensions(level.height, level.width)
  return inferredFromName || inferredFromDimensions || 'Kaynak'
}

export function buildVideoQualityOptions(levels: VideoLevelLike[]): VideoQualityOption[] {
  if (levels.length === 0) return []

  return [
    {
      id: AUTO_VIDEO_QUALITY_ID,
      label: 'Otomatik',
      shortLabel: 'Oto',
      auto: true
    },
    ...levels.map((level, index) => {
      const shortLabel = formatVideoQualityLabel(level)
      const bitrateLabel = formatBitrate(level.bitrate)

      return {
        id: getVideoQualityId(index),
        label: bitrateLabel ? `${shortLabel} · ${bitrateLabel}` : shortLabel,
        shortLabel,
        bitrate: level.bitrate,
        height: level.height
      }
    })
  ]
}

export function buildMpvVideoQualityOptions(
  tracks: Array<VideoLevelLike & { id: number }>
): VideoQualityOption[] {
  if (tracks.length === 0) return []

  return [
    {
      id: AUTO_VIDEO_QUALITY_ID,
      label: 'Otomatik',
      shortLabel: 'Oto',
      auto: true
    },
    ...tracks.map((track) => {
      const shortLabel = formatVideoQualityLabel(track)
      const bitrateLabel = formatBitrate(track.bitrate)

      return {
        id: getMpvVideoQualityId(track.id),
        label: bitrateLabel ? `${shortLabel} · ${bitrateLabel}` : shortLabel,
        shortLabel,
        bitrate: track.bitrate,
        height: track.height
      }
    })
  ]
}

export function getActiveVideoQualityId(levelIndex: number | null | undefined): string | null {
  if (typeof levelIndex !== 'number' || levelIndex < 0) return null
  return getVideoQualityId(levelIndex)
}

export function getActiveMpvVideoQualityId(trackId: number | null | undefined): string | null {
  if (typeof trackId !== 'number' || trackId < 0) return null
  return getMpvVideoQualityId(trackId)
}
