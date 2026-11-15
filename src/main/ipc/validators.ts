import type { MpvPlaybackTuning, MpvSubtitleStyle } from '../../shared/types/electron-ipc'
import { mainStrings } from '../../shared/main-strings'

const ALLOWED_STREAM_PROTOCOLS = new Set(['http:', 'https:'])
const MAX_STREAM_URL_LENGTH = 4096
const MAX_COLOR_VALUE_LENGTH = 64
const MAX_TUNING_DELAY_SECONDS = 10
const MIN_PLAYBACK_SPEED = 0.25
const MAX_PLAYBACK_SPEED = 4
const ALLOWED_ASPECT_RATIOS = new Set<MpvPlaybackTuning['aspectRatio']>(['auto', '16:9', '4:3'])

export function isValidStreamUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_STREAM_URL_LENGTH) return false

  try {
    return ALLOWED_STREAM_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}

export function isValidMpvTrackId(value: unknown): value is number | null {
  if (value === null) return true
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export function isValidStreamIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function clampNormalizedVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(mainStrings.invalid.volume)
  }
  return Math.round(Math.max(0, Math.min(1, value)) * 100)
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

export function isValidMpvSubtitleStyle(value: unknown): value is MpvSubtitleStyle {
  if (!value || typeof value !== 'object') return false
  const style = value as MpvSubtitleStyle
  return (
    typeof style.fontSize === 'number' &&
    Number.isFinite(style.fontSize) &&
    isBoundedText(style.color, MAX_COLOR_VALUE_LENGTH) &&
    isBoundedText(style.background, MAX_COLOR_VALUE_LENGTH)
  )
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

export function isValidPlaybackTuning(value: unknown): value is MpvPlaybackTuning {
  if (!value || typeof value !== 'object') return false
  const tuning = value as MpvPlaybackTuning
  return (
    isFiniteInRange(tuning.audioDelay, -MAX_TUNING_DELAY_SECONDS, MAX_TUNING_DELAY_SECONDS) &&
    isFiniteInRange(tuning.subDelay, -MAX_TUNING_DELAY_SECONDS, MAX_TUNING_DELAY_SECONDS) &&
    isFiniteInRange(tuning.speed, MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED) &&
    ALLOWED_ASPECT_RATIOS.has(tuning.aspectRatio)
  )
}

export function requireBoolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new Error(message)
  return value
}

export function requireFiniteNumber(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(message)
  return value
}
