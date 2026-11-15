import { itemAt } from '../../../shared/checked'
import type { EPGProgram } from '@/types/epg'
import { normalizeLanguageCode } from './track-preferences'

/*
 * Guide helpers shared by the page and the parser (`xmltv-parser.ts`, which
 * runs in the catalog worker): the time window, channel keys, entity
 * decoding, language choice, and finding the current programme.
 */

// Only programmes within a time window are kept.
export const EPG_WINDOW_HOURS_BEFORE = 2
export const EPG_WINDOW_HOURS_AFTER = 24
/** Channels kept; the old in-thread parser stopped at 2,000. */
export const MAX_EPG_CHANNELS = 20_000
export const MAX_PROGRAMMES_PER_CHANNEL = 100
/** Descriptions are shown on one line; longer ones are cut to save memory. */
export const MAX_DESCRIPTION_CHARS = 500

export function epgWindow(now = Date.now()): { windowStart: number; windowEnd: number } {
  return {
    windowStart: now - EPG_WINDOW_HOURS_BEFORE * 3600_000,
    windowEnd: now + EPG_WINDOW_HOURS_AFTER * 3600_000
  }
}

// Keys from untrusted XML are used as property names. Without protection, a channel
// id like "__proto__" or "constructor" can pollute Object prototype and cause subtle
// runtime bugs or unsafe downstream lookups. We reject these unsafe keys outright.
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const XML_NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&'
}

/**
 * Decodes the five predefined XML entities and numeric references, and
 * nothing else: a hostile feed's DOCTYPE entities are never expanded, so
 * "Tom &amp; Jerry" reads right and `&custom;` stays as written.
 */
export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) return value

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }

    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }

    return XML_NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

export interface LocalizedText {
  text: string
  /** The element's `lang` attribute as written, '' when absent. */
  lang: string
}

/** Languages tried in order before falling back to the first text. */
export const PREFERRED_EPG_LANGUAGES: readonly string[] = ['tr']

/** The preferred entry of already decoded texts: Turkish first ("tr", "tur", "tr-TR"), else the first. */
export function pickPreferred(texts: readonly LocalizedText[], preferredLanguages: readonly string[]): LocalizedText | undefined {
  for (const preferred of preferredLanguages) {
    const wanted = normalizeLanguageCode(preferred)
    if (!wanted) continue
    const match = texts.find((entry) => {
      const lang = normalizeLanguageCode(entry.lang)
      return lang === wanted || lang.startsWith(`${wanted}-`)
    })
    if (match) return match
  }
  return texts[0]
}

export function normalizeEpgChannelKey(id: string | null | undefined): string | null {
  if (!id) return null
  // EPG IDs are technical identifiers (e.g. "istanbul.tr", "TRT1.tr") — compare
  // them ASCII-case-insensitively. Turkish-locale lowercasing would map 'I' to
  // 'ı', which desyncs ids like "Istanbul.tr" (from XML) vs "istanbul.tr"
  // (from a channel) that callers expect to match.
  const key = id.toLowerCase()
  if (!key || UNSAFE_KEYS.has(key)) return null
  return key
}

export function findCurrentProgram(programs: EPGProgram[], now?: number): EPGProgram | null {
  const timestamp = now ?? Date.now()
  if (!programs || programs.length === 0) return null

  let low = 0
  let high = programs.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const prog = itemAt(programs, mid)
    if (timestamp >= prog.start && timestamp < prog.end) return prog
    if (timestamp < prog.start) high = mid - 1
    else low = mid + 1
  }

  return null
}

export function getUpcomingPrograms(programs: EPGProgram[], count = 5, now?: number): EPGProgram[] {
  const timestamp = now ?? Date.now()
  if (!programs) return []
  const idx = programs.findIndex((p) => p.end > timestamp)
  if (idx === -1) return []
  return programs.slice(idx, idx + count)
}
