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

/** Why a guide is incomplete: the download ended mid-document, or it had more channels or programmes than are kept. */
export type EPGTruncation = 'cut-off' | 'limit'

export interface EPGData {
  channels: Record<string, EPGChannel>
  programs: Record<string, EPGProgram[]>
  lastUpdated: number
  /**
   * True when only part of the guide could be read (see `truncatedReason`).
   * Channels and programmes past that point are missing, so the UI says the
   * guide is incomplete.
   */
  truncated?: boolean
  truncatedReason?: EPGTruncation
}
