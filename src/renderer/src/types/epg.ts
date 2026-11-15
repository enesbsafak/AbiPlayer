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
  /**
   * True when the download hit the size limit and only the part before the
   * cut was parsed. Channels and programmes past that point are missing, so
   * the UI should say the guide is incomplete.
   */
  truncated?: boolean
}
