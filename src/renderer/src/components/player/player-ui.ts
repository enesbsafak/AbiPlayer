import { createContext, useContext, useLayoutEffect, useState } from 'react'
import { TONE, type Tone } from '@/components/layout/sections'
import type { CurrentPlayback } from '@/types/player'
import type { Channel } from '@/types/playlist'

/*
 * The player's share of the "Canlı renk" language. The picture is drawn by
 * mpv in a native layer underneath the (transparent) page, so nothing here
 * blurs, shades or fades into it: surfaces are flat and nearly opaque.
 */

/** The dock, the top pills and the notices: the ground at 94 %. */
export const OVER_VIDEO = 'bg-ground/[0.94]'

/**
 * How the dock's controls row is drawn: `l` labels everything, `m` drops the
 * labels of previous / next and the list, `s` is icons only, `xs` is smaller
 * icons without the volume slider.
 */
export type DockSize = 'l' | 'm' | 's' | 'xs'

/** What the controls row holds right now (selectors without anything to pick are not drawn). */
export interface DockParts {
  /** Film and episode: the two 10-second steps. */
  seeks: boolean
  /** Track, quality and tuning pickers shown. */
  pickers: number
  /** Picture-in-picture (HTML5 engine only). */
  pip: boolean
}

const GAP = 8
/**
 * Widths as the classes draw them; a picker pill at a typical value, not its
 * cap. Play counts its 4 px margins, volume its 4 px margin, the gap and the slider.
 */
const PART_WIDTH: Record<DockSize, { step: number; play: number; volume: number; picker: number; list: number; round: number }> = {
  l: { step: 128, play: 60, volume: 158, picker: 150, list: 176, round: 44 },
  m: { step: 44, play: 60, volume: 158, picker: 132, list: 44, round: 44 },
  s: { step: 44, play: 60, volume: 142, picker: 44, list: 44, round: 44 },
  xs: { step: 40, play: 56, volume: 44, picker: 40, list: 40, round: 40 }
}

/** The controls row's width at `size`, gaps included. Exported for its tests. */
export function rowWidth(size: DockSize, parts: DockParts): number {
  const w = PART_WIDTH[size]
  const left = [w.step, w.step, w.play, w.volume, ...(parts.seeks ? [w.round, w.round] : [])]
  const right = [...Array<number>(parts.pickers).fill(w.picker), w.list, w.round, ...(parts.pip ? [w.round] : [])]
  const items = [...left, ...right]
  // Every item but the last has a gap after it, plus the one around the spacer.
  return items.reduce((sum, part) => sum + part, 0) + items.length * GAP
}

/**
 * The largest size whose row fits `width` (the dock's inner width, measured
 * on the dock itself: the channel list takes 288 px off a narrow window, so
 * the window width alone says little). Should a long value still not fit, the
 * row wraps rather than running out of the dock.
 */
export function dockSizeFor(width: number, parts: DockParts): DockSize {
  for (const size of ['l', 'm', 's'] as const) {
    if (rowWidth(size, parts) <= width) return size
  }
  return 'xs'
}

interface DockLayout {
  size: DockSize
  /** The colour of the section the item belongs to: what "current" is filled with. */
  tone: Tone
}

export const DockLayoutContext = createContext<DockLayout>({ size: 'l', tone: 'coral' })

export function useDockLayout(): DockLayout {
  return useContext(DockLayoutContext)
}

/** Round buttons and pills share one height per dock size: 44 px, 40 in the narrowest dock. */
export const CONTROL_SIZE: Record<DockSize, { round: string; height: string; icon: number }> = {
  l: { round: 'size-11', height: 'h-11', icon: 20 },
  m: { round: 'size-11', height: 'h-11', icon: 20 },
  s: { round: 'size-11', height: 'h-11', icon: 20 },
  xs: { round: 'size-10', height: 'h-10', icon: 18 }
}

/** The fill and text of something open, pressed or current: the section colour with ink. */
export function filledClasses(tone: Tone): string {
  return `${TONE[tone].fill} text-ink`
}

/**
 * A round button that only shows a glyph (it always carries an accessible
 * name): raised, or filled with `activeTone` while it is open or pressed.
 */
export function roundButton(size: DockSize, activeTone?: Tone): string {
  const look = activeTone
    ? filledClasses(activeTone)
    : 'bg-raised text-white hover:bg-surface-800 disabled:hover:bg-raised'
  return `flex ${CONTROL_SIZE[size].round} shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${look}`
}

/** Which section's colour the item playing wears: coral live, sky episodes, mint films. */
export function playerTone(playback: CurrentPlayback | null, channel: Channel | null): Tone {
  const target = playback?.target
  if (target) {
    if (target.kind === 'live' || (target.kind === 'm3u' && target.mediaType === 'live')) return 'coral'
    if (
      target.kind === 'episode' ||
      (target.kind === 'm3u' && target.mediaType === 'series') ||
      (target.kind === 'addon' && target.contentType === 'series')
    ) {
      return 'sky'
    }
    return 'mint'
  }
  if (channel?.type === 'live') return 'coral'
  return channel?.type === 'series' ? 'sky' : 'mint'
}

/** Popover panels that open upward from a dock control: raised, so they read above the dock. */
export const MENU_PANEL =
  'absolute bottom-full right-0 z-dropdown mb-3 max-h-[calc(100vh-12rem)] overflow-y-auto rounded-tile bg-raised p-2 text-white'

/** A heading inside a panel. */
export const MENU_HEADING = 'font-title px-3 pb-2 pt-2 text-[22px] leading-[1.15]'

/** One choice in a panel: a generous row, filled when it is the current one. */
export function menuRow(isCurrent: boolean, tone: Tone): string {
  return `flex min-h-12 w-full items-center justify-between gap-3 rounded-card px-4 py-2 text-left text-[15px] transition-colors ${
    isCurrent ? `${filledClasses(tone)} font-bold` : 'font-medium text-white hover:bg-surface-800'
  }`
}

/** A small choice pill (speed, aspect) on a ground well: filled when chosen. */
export function choicePill(isChosen: boolean, tone: Tone): string {
  return `flex h-10 min-w-[52px] items-center justify-center rounded-full px-4 text-[15px] font-bold transition-colors ${
    isChosen ? filledClasses(tone) : 'bg-raised text-white hover:bg-surface-800'
  }`
}

/** A position or a length: "4:05", "1:02:09"; "--:--" when unknown. */
export function formatTime(s: number) {
  if (!isFinite(s)) return '--:--'
  const totalSeconds = Math.max(0, Math.floor(s))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** The content width of `element`, followed as it changes. */
export function useElementWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0)
  // Measured before paint, so the dock never shows one frame at the wrong size.
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return width
}
