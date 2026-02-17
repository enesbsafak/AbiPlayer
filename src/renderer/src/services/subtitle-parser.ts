import type { SubtitleCue, SubtitleStyle } from '@/types/player'

function parseTimeSRT(str: string): number {
  // 00:01:23,456 -> seconds
  const parts = str.trim().split(':')
  const [sec, ms] = (parts[2] || '0,0').split(/[,.]/)
  return (
    parseInt(parts[0]) * 3600 +
    parseInt(parts[1]) * 60 +
    parseInt(sec) +
    parseInt((ms || '0').padEnd(3, '0')) / 1000
  )
}

function parseTimeVTT(str: string): number {
  // 00:01:23.456 or 01:23.456
  const parts = str.trim().split(':')
  if (parts.length === 2) {
    const [sec, ms] = parts[1].split('.')
    return parseInt(parts[0]) * 60 + parseInt(sec) + parseInt((ms || '0').padEnd(3, '0')) / 1000
  }
  const [sec, ms] = (parts[2] || '0.0').split('.')
  return (
    parseInt(parts[0]) * 3600 +
    parseInt(parts[1]) * 60 +
    parseInt(sec) +
    parseInt((ms || '0').padEnd(3, '0')) / 1000
  )
}

function stripHTMLTags(text: string): string {
  return text.replace(/<[^>]+>/g, '')
}

export function parseSRT(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const blocks = content.trim().split(/\n\s*\n/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    // Find the timing line (skip sequence number)
    let timingIdx = 0
    if (/^\d+$/.test(lines[0].trim())) timingIdx = 1

    const timingLine = lines[timingIdx]
    if (!timingLine) continue

    const match = timingLine.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/)
    if (!match) continue

    const text = lines
      .slice(timingIdx + 1)
      .join('\n')
      .trim()

    cues.push({
      startTime: parseTimeSRT(match[1]),
      endTime: parseTimeSRT(match[2]),
      text: stripHTMLTags(text)
    })
  }

  return cues
}

export function parseVTT(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  // Remove WEBVTT header and metadata
  const cleaned = content.replace(/^WEBVTT[^\n]*\n/, '').replace(/^NOTE[^\n]*\n(?:[^\n]+\n)*/gm, '')
  const blocks = cleaned.trim().split(/\n\s*\n/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    // Find timing line
    let timingIdx = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timingIdx = i
        break
      }
    }

    const timingLine = lines[timingIdx]
    const match = timingLine.match(/([\d:.]+)\s*-->\s*([\d:.]+)/)
    if (!match) continue

    const text = lines
      .slice(timingIdx + 1)
      .join('\n')
      .trim()

    cues.push({
      startTime: parseTimeVTT(match[1]),
      endTime: parseTimeVTT(match[2]),
      text: stripHTMLTags(text)
    })
  }

  return cues
}

function parseASSTime(str: string): number {
  // 0:00:01.23 -> seconds
  const parts = str.trim().split(':')
  const [sec, cs] = (parts[2] || '0.0').split('.')
  return (
    parseInt(parts[0]) * 3600 +
    parseInt(parts[1]) * 60 +
    parseInt(sec) +
    parseInt((cs || '0').padEnd(2, '0')) / 100
  )
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
  const lines = content.split(/\r?\n/)

  let eventFormatFields: string[] = []
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
        eventFormatFields = line
          .replace('Format:', '')
          .split(',')
          .map((f) => f.trim())
        continue
      }
      if (line.startsWith('Dialogue:')) {
        const rest = line.replace('Dialogue:', '').trim()
        // Split only up to the number of format fields - 1, last field is Text
        const values = rest.split(',')
        const textIdx = eventFormatFields.indexOf('Text')
        const text = values.slice(textIdx).join(',').trim()

        // Remove ASS override tags like {\pos(x,y)} {\an8} etc
        const cleanText = stripHTMLTags(
          text
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\N/g, '\n')
            .replace(/\\n/g, '\n')
            .trim()
        )

        const startIdx = eventFormatFields.indexOf('Start')
        const endIdx = eventFormatFields.indexOf('End')
        const styleIdx = eventFormatFields.indexOf('Style')

        if (startIdx === -1 || endIdx === -1) continue

        const style = styleIdx !== -1 ? styles.get(values[styleIdx]?.trim()) : undefined

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
    default:
      // Try SRT first, then VTT
      if (content.includes('-->') && !content.startsWith('WEBVTT')) return parseSRT(content)
      if (content.startsWith('WEBVTT')) return parseVTT(content)
      return parseSRT(content)
  }
}
