/**
 * `source` keeps whatever order the provider sent (M3U line order, Xtream API
 * order); `name` sorts A-Z. Default is `name` because provider order routinely
 * puts adult groups first in M3U playlists.
 */
export type CatalogSortMode = 'name' | 'source'

export interface UserSettings {
  theme: 'dark' | 'light'
  language: string
  catalogSortMode: CatalogSortMode
  epgRefreshInterval: number // minutes
  defaultVolume: number // 0-1
  preferredAudioLanguage: string // auto | IETF language tag (tr, en, en-us, ...)
  preferredSubtitleLanguage: string // auto | IETF language tag
  defaultSubtitleEnabled: boolean
  autoPlay: boolean
  showAdultContent: boolean
  subtitleFontSize: number
  subtitleColor: string
  subtitleBackground: string
  tmdbApiKey: string
  channelViewMode: 'grid' | 'list'
  epgTimeFormat: '12h' | '24h'
  bufferLength: number // seconds
  hardwareAcceleration: boolean
  // Off by default: it only helps when an AV receiver is decoding, and mpv
  // needs an active stream before it can tell whether the device accepts it.
  audioPassthrough: boolean
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  language: 'tr',
  catalogSortMode: 'name',
  epgRefreshInterval: 60,
  defaultVolume: 0.8,
  preferredAudioLanguage: 'auto',
  preferredSubtitleLanguage: 'auto',
  defaultSubtitleEnabled: false,
  autoPlay: true,
  showAdultContent: false,
  subtitleFontSize: 24,
  subtitleColor: '#ffffff',
  subtitleBackground: 'rgba(0,0,0,0.75)',
  tmdbApiKey: '',
  channelViewMode: 'grid',
  epgTimeFormat: '24h',
  bufferLength: 30,
  hardwareAcceleration: true,
  audioPassthrough: false
}
