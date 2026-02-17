export interface EPGProgram {
  channelId: string
  title: string
  description?: string
  start: number
  end: number
  category?: string
  icon?: string
  lang?: string
}

export interface EPGChannel {
  id: string
  displayName: string
  icon?: string
}

export interface EPGData {
  channels: Record<string, EPGChannel>
  programs: Record<string, EPGProgram[]>
  lastUpdated: number
}
