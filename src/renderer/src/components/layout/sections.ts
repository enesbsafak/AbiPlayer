import type { ComponentType } from 'react'
import {
  FilmIcon,
  GuideIcon,
  LiveIcon,
  SearchIcon,
  SeriesIcon,
  SlidersIcon,
  StarIcon,
  type IconProps
} from '@/components/ui/icons'
import type { SectionKey } from '@/theme/palette'
import { strings } from '@/strings'

const nav = strings.shell.nav

/**
 * Class names per colour, written out in full so Tailwind finds them: the
 * fill, the ink-on-colour text, and the plain text colour.
 */
export const TONE = {
  coral: { fill: 'bg-coral', text: 'text-coral' },
  sun: { fill: 'bg-sun', text: 'text-sun' },
  mint: { fill: 'bg-mint', text: 'text-mint' },
  sky: { fill: 'bg-sky', text: 'text-sky' },
  /** Pages that own no colour: the raised surface with a white glyph. */
  neutral: { fill: 'bg-raised', text: 'text-white' }
} as const

export type Tone = keyof typeof TONE

export interface ScreenInfo {
  path: string
  title: string
  tone: Tone
  icon: ComponentType<IconProps>
  /** One of the four sections the switcher lists. */
  section?: SectionKey
}

/** The four sections, in the order of the home tiles and the switcher. */
export const SECTIONS: readonly (ScreenInfo & { section: SectionKey })[] = [
  { path: '/live', title: nav.live, tone: 'coral', icon: LiveIcon, section: 'live' },
  { path: '/epg', title: nav.epg, tone: 'sun', icon: GuideIcon, section: 'epg' },
  { path: '/vod', title: nav.vod, tone: 'mint', icon: FilmIcon, section: 'vod' },
  { path: '/series', title: nav.series, tone: 'sky', icon: SeriesIcon, section: 'series' }
]

/** The other inner screens. Favourites wear the sun of the home bar's star, settings the sky of its sliders. */
const OTHER_SCREENS: readonly ScreenInfo[] = [
  { path: '/favorites', title: nav.favorites, tone: 'sun', icon: StarIcon },
  { path: '/settings', title: nav.settings, tone: 'sky', icon: SlidersIcon },
  { path: '/search', title: nav.search, tone: 'neutral', icon: SearchIcon }
]

/** What the inner top bar shows for a route; null for home, the player and unknown paths. */
export function screenFor(pathname: string): ScreenInfo | null {
  return [...SECTIONS, ...OTHER_SCREENS].find((screen) => screen.path === pathname) ?? null
}
