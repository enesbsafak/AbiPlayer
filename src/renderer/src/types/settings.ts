export interface UserSettings {
  epgRefreshInterval: number // minutes
  preferredAudioLanguage: string // auto | IETF language tag (tr, en, en-us, ...)
  preferredSubtitleLanguage: string // auto | IETF language tag
  defaultSubtitleEnabled: boolean
  showAdultContent: boolean
  subtitleFontSize: number
  subtitleColor: string
  subtitleBackground: string
  // Kept in memory only: it is stored in the secure credential store, never
  // in localStorage (store/index.ts strips it from the persisted settings).
  tmdbApiKey: string
  epgTimeFormat: '12h' | '24h'
  hardwareAcceleration: boolean
  // Off by default: it only helps when an AV receiver is decoding, and mpv
  // needs an active stream before it can tell whether the device accepts it.
  audioPassthrough: boolean
  // Format of Xtream live channels with mpv: 'auto' (HLS when the account
  // allows it), 'm3u8' (HLS) or 'ts' (MPEG-TS). The HTML5 engine always gets HLS.
  liveStreamFormat: 'auto' | 'm3u8' | 'ts'
  // Experimental (plan F2-15): mpv keeps playing in a corner of the window
  // while the user browses, instead of the "paused, continue" card.
  keepPlayingInCorner: boolean
  // How far the arrow keys and the player's back/forward buttons seek (seconds).
  seekStepSeconds: number
}

export const SEEK_STEP_OPTIONS: readonly number[] = [5, 10, 15, 30]
export const DEFAULT_SEEK_STEP_SECONDS = 10

export const DEFAULT_SETTINGS: UserSettings = {
  epgRefreshInterval: 60,
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
  audioPassthrough: false,
  liveStreamFormat: 'auto',
  keepPlayingInCorner: false,
  seekStepSeconds: DEFAULT_SEEK_STEP_SECONDS
}
