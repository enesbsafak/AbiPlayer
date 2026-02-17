import type { Channel } from '@/types/playlist'

export function isPlayableChannel(channel: Channel): boolean {
  const streamUrl = channel.streamUrl?.trim()
  if (!streamUrl) return false

  try {
    const parsed = new URL(streamUrl)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
