import type { SubtitleCue, SubtitleStyle } from '@/types/player'
import { itemAt } from '../../../shared/checked'

/** A time field of untrusted subtitle text; missing or garbled counts as 0. */
function toInt(value: string | undefined): number {
  return value ? parseInt(value) || 0 : 0
}

function parseTimeSRT(str: string): number {
  if (!str) return 0
  const parts = str.trim().split(':')
  if (parts.length < 2) return 0
  // h:mm:ss,ms or, when the hour is left out, mm:ss,ms.
  const hasHours = parts.length >= 3
  const [sec, ms] = (parts[hasHours ? 2 : 1] || '0,0').split(/[,.]/)
  const h = hasHours ? toInt(parts[0]) : 0
  const m = toInt(parts[hasHours ? 1 : 0])
  const s = toInt(sec)
  const msVal = parseInt((ms || '0').slice(0, 3).padEnd(3, '0')) || 0
  return h * 3600 + m * 60 + s + msVal / 1000
}

/**
 * SRT timing as it appears in the wild, not only as the spec writes it:
 * hours with one to three digits or left out, one to three fraction digits
 * after a comma or a dot, or no fraction at all. "0:01:02,50" is as valid as
 * "00:01:02,500".
 */
const SRT_TIME = String.raw`(?:\d{1,3}:)?\d{1,2}:\d{1,2}(?:[,.]\d{1,3})?`
const SRT_TIMING_PATTERN = new RegExp(String.raw`(${SRT_TIME})\s*-->\s*(${SRT_TIME})`)

/** Drop a byte order mark and normalize line endings to LF. */
function normalizeSubtitleText(content: string): string {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  return withoutBom.replace(/\r\n?/g, '\n')
}

function parseTimeVTT(str: string): number {
  if (!str) return 0
  const clean = str.trim()
  const parts = clean.split(':')
  if (parts.length === 1) {
    const [sec, ms] = clean.split('.')
    const s = toInt(sec)
    const m = parseInt((ms || '0').padEnd(3, '0')) || 0
    return s + m / 1000
  }
  if (parts.length === 2) {
    const [sec, ms] = (parts[1] || '0.0').split('.')
    const h = toInt(parts[0])
    const s = toInt(sec)
    const m = parseInt((ms || '0').padEnd(3, '0')) || 0
    return h * 60 + s + m / 1000
  }
  const [sec, ms] = (parts[2] || '0.0').split('.')
  const h = toInt(parts[0])
  const m = toInt(parts[1])
  const s = toInt(sec)
  const msVal = parseInt((ms || '0').padEnd(3, '0')) || 0
  return h * 3600 + m * 60 + s + msVal / 1000
}

function stripHTMLTags(text: string): string {
  return text.replace(/<[^>]+>/g, '')
}

export function parseSRT(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const blocks = normalizeSubtitleText(content).trim().split(/\n\s*\n/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    // Find the timing line (skip sequence number)
    let timingIdx = 0
    if (/^\d+$/.test(itemAt(lines, 0).trim())) timingIdx = 1

    const timingLine = lines[timingIdx]
    if (!timingLine) continue

    const match = timingLine.match(SRT_TIMING_PATTERN)
    if (!match) continue

    const text = lines
      .slice(timingIdx + 1)
      .join('\n')
      .trim()

    cues.push({
      startTime: parseTimeSRT(itemAt(match, 1)),
      endTime: parseTimeSRT(itemAt(match, 2)),
      text: stripHTMLTags(text)
    })
  }

  return cues
}

export function parseVTT(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  // Remove WEBVTT header and metadata
  const cleaned = normalizeSubtitleText(content).replace(/^WEBVTT[^\n]*\n/, '').replace(/^NOTE[^\n]*\n(?:[^\n]+\n)*/gm, '')
  const blocks = cleaned.trim().split(/\n\s*\n/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    // Find timing line
    const timingIdx = Math.max(0, lines.findIndex((line) => line.includes('-->')))

    const timingLine = itemAt(lines, timingIdx)
    const match = timingLine.match(/([\d:.]+)\s*-->\s*([\d:.]+)/)
    if (!match) continue

    const text = lines
      .slice(timingIdx + 1)
      .join('\n')
      .trim()

    cues.push({
      startTime: parseTimeVTT(itemAt(match, 1)),
      endTime: parseTimeVTT(itemAt(match, 2)),
      text: stripHTMLTags(text)
    })
  }

  return cues
}

function parseASSTime(str: unknown): number {
  if (typeof str !== 'string') return 0
  const parts = str.trim().split(':')
  if (parts.length < 3) return 0
  const [sec, cs] = (parts[2] || '0.0').split('.')
  const h = toInt(parts[0])
  const m = toInt(parts[1])
  const s = toInt(sec)
  const csVal = parseInt((cs || '0').padEnd(2, '0')) || 0
  return h * 3600 + m * 60 + s + csVal / 100
}

function parseASSStyle(styleLine: string, formatLine: string): Map<string, SubtitleStyle> {
  const styles = new Map<string, SubtitleStyle>()
  const formatFields = formatLine
    .replace('Format:', '')
    .split(',')
    .map((f) => f.trim())

  const entries = styleLine.split('\n').filter((l) => l.startsWith('Style:'))
  for (const entry of entries) {
    const values = entry.replace('Style:', '').split(',').map((v) => v.trim())
    const style: SubtitleStyle = {}
    let name = 'Default'

    formatFields.forEach((field, i) => {
      const val = values[i]
      // A style line shorter than its format line: the missing fields keep their defaults.
      if (val === undefined) return
      switch (field) {
        case 'Name':
          name = val
          break
        case 'Fontsize':
          style.fontSize = `${val}px`
          break
        case 'Bold':
          style.bold = val === '-1' || val === '1'
          break
        case 'Italic':
          style.italic = val === '-1' || val === '1'
          break
        case 'Alignment':
          style.alignment = parseInt(val)
          break
        case 'MarginV':
          style.marginV = parseInt(val)
          break
        case 'Outline':
          style.outline = parseFloat(val)
          break
        case 'Shadow':
          style.shadow = parseFloat(val)
          break
      }
    })

    styles.set(name, style)
  }

  return styles
}

export function parseASS(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const lines = normalizeSubtitleText(content).split('\n')

  let eventFormatIndex = new Map<string, number>()
  let styles = new Map<string, SubtitleStyle>()
  let styleFormatLine = ''
  let styleLines = ''
  let inStyles = false
  let inEvents = false

  for (const line of lines) {
    if (line.startsWith('[V4+ Styles]') || line.startsWith('[V4 Styles]')) {
      inStyles = true
      inEvents = false
      continue
    }
    if (line.startsWith('[Events]')) {
      inEvents = true
      inStyles = false
      if (styleFormatLine && styleLines) {
        styles = parseASSStyle(styleLines, styleFormatLine)
      }
      continue
    }
    if (line.startsWith('[')) {
      inStyles = false
      inEvents = false
      continue
    }

    if (inStyles) {
      if (line.startsWith('Format:')) styleFormatLine = line
      if (line.startsWith('Style:')) styleLines += line + '\n'
    }

    if (inEvents) {
      if (line.startsWith('Format:')) {
        const eventFormatFields = line
          .replace('Format:', '')
          .split(',')
          .map((f) => f.trim())
        eventFormatIndex = new Map(eventFormatFields.map((field, index) => [field, index]))
        continue
      }
      if (line.startsWith('Dialogue:')) {
        const rest = line.replace('Dialogue:', '').trim()
        // Split only up to the number of format fields - 1, last field is Text
        const values = rest.split(',')
        const textIdx = eventFormatIndex.get('Text') ?? -1
        if (textIdx === -1) continue
        const text = values.slice(textIdx).join(',').trim()

        // Remove ASS override tags like {\pos(x,y)} {\an8} etc
        const cleanText = stripHTMLTags(
          text
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\N/g, '\n')
            .replace(/\\n/g, '\n')
            .trim()
        )

        const startIdx = eventFormatIndex.get('Start') ?? -1
        const endIdx = eventFormatIndex.get('End') ?? -1
        const styleIdx = eventFormatIndex.get('Style') ?? -1

        if (startIdx === -1 || endIdx === -1) continue

        const styleName = styleIdx !== -1 ? values[styleIdx]?.trim() : undefined
        const style = styleName !== undefined ? styles.get(styleName) : undefined

        cues.push({
          startTime: parseASSTime(values[startIdx]),
          endTime: parseASSTime(values[endIdx]),
          text: cleanText,
          style
        })
      }
    }
  }

  return cues
}

export function parseSubtitles(content: string, filename: string): SubtitleCue[] {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'srt':
      return parseSRT(content)
    case 'vtt':
      return parseVTT(content)
    case 'ass':
    case 'ssa':
      return parseASS(content)
    default: {
      // No usable extension: sniff the content. A BOM in front of "WEBVTT"
      // used to send VTT files to the SRT parser.
      const head = normalizeSubtitleText(content).trimStart()
      if (head.startsWith('WEBVTT')) return parseVTT(content)
      if (/^\[Script Info\]/i.test(head)) return parseASS(content)
      return parseSRT(content)
    }
  }
}
