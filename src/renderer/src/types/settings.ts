export interface UserSettings {
  theme: 'dark' | 'light'
  language: string
  epgRefreshInterval: number // minutes
  defaultVolume: number // 0-1
  autoPlay: boolean
  showAdultContent: boolean
  subtitleFontSize: number
  subtitleColor: string
  subtitleBackground: string
  channelViewMode: 'grid' | 'list'
  epgTimeFormat: '12h' | '24h'
  bufferLength: number // seconds
  hardwareAcceleration: boolean
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  language: 'en',
  epgRefreshInterval: 60,
  defaultVolume: 0.8,
  autoPlay: true,
  showAdultContent: false,
  subtitleFontSize: 24,
  subtitleColor: '#ffffff',
  subtitleBackground: 'rgba(0,0,0,0.75)',
  channelViewMode: 'grid',
  epgTimeFormat: '24h',
  bufferLength: 30,
  hardwareAcceleration: true
}
