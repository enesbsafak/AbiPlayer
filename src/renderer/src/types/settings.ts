export interface UserSettings {
  theme: 'dark' | 'light'
  language: string
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
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  language: 'tr',
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
  hardwareAcceleration: true
}
