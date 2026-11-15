export interface UserSettings {
  epgRefreshInterval: number // minutes
  defaultVolume: number // 0-1
  preferredAudioLanguage: string // auto | IETF language tag (tr, en, en-us, ...)
  preferredSubtitleLanguage: string // auto | IETF language tag
  defaultSubtitleEnabled: boolean
  showAdultContent: boolean
  subtitleFontSize: number
  subtitleColor: string
  subtitleBackground: string
  tmdbApiKey: string
  epgTimeFormat: '12h' | '24h'
  hardwareAcceleration: boolean
  // Off by default: it only helps when an AV receiver is decoding, and mpv
  // needs an active stream before it can tell whether the device accepts it.
  audioPassthrough: boolean
}

export const DEFAULT_SETTINGS: UserSettings = {
  epgRefreshInterval: 60,
  defaultVolume: 0.8,
  preferredAudioLanguage: 'auto',
  preferredSubtitleLanguage: 'auto',
  defaultSubtitleEnabled: false,
  showAdultContent: false,
  subtitleFontSize: 24,
  subtitleColor: '#ffffff',
  subtitleBackground: 'rgba(0,0,0,0.75)',
  tmdbApiKey: '',
  epgTimeFormat: '24h',
  hardwareAcceleration: true,
  audioPassthrough: false
}
