/*
 * The "Canlı renk" palette (docs/tasarim): one dark ground, one raised
 * surface, white text, and four flat colours that each own a section of the
 * app. Text on a section colour is always `ink`. No gradients, no shadows.
 *
 * tailwind.config.ts builds the theme from this file, and code that needs a
 * colour as a value (an inline style, a canvas) imports it from here, so a
 * colour is defined once.
 */

export const palette = {
  /** The page. */
  ground: '#15121C',
  /** Pills, rows, cards and panels on the ground. */
  raised: '#2A2433',
  /** Below the ground: key caps, wells, the edge under a raised control. */
  deep: '#0B0910',
  /** Text and icons on a section colour or on white. */
  ink: '#17131F',
  /** Canlı TV, and anything live. */
  coral: '#FF6B4A',
  /** Yayın Akışı, progress, highlights and keyboard focus. */
  sun: '#FFC83D',
  /** Filmler, and "connected" / "on". */
  mint: '#5BE0B3',
  /** Diziler, and settings. */
  sky: '#7DB8FF'
} as const

/**
 * The neutral scale the existing pages are written against (`surface-*`),
 * remapped onto the palette: 950 is the ground, 900 the raised surface, 800 to
 * 600 the hover and edge steps above it, and 500 up to 50 white text at 72 %
 * and stronger, blended onto the ground so it stays opaque.
 */
export const surfaceScale = {
  50: '#FFFFFF',
  100: '#F8F8F9',
  200: '#F1F1F1',
  300: '#E3E3E4',
  400: '#D0D0D2',
  500: '#BDBDBF',
  600: '#827D8A',
  700: '#433B4F',
  800: '#352E40',
  900: palette.raised,
  950: palette.ground
} as const

export type SectionKey = 'live' | 'epg' | 'vod' | 'series'

/** The colour that owns each section. */
export const SECTION_COLOR: Record<SectionKey, keyof typeof palette> = {
  live: 'coral',
  epg: 'sun',
  vod: 'mint',
  series: 'sky'
}

/**
 * The home destination tiles' gradients (an owner-requested experiment; the
 * flat colours above stay the language, and HomeTiles has the one switch).
 * Each runs diagonally within its own colour family: a lighter tint, the
 * section colour, then a deeper neighbour. Ink on the deepest stop:
 * coral 5.7:1, sun 9.4:1, mint 8.9:1, sky 7.2:1 (and the 85 % ink second
 * line at least 4.8:1), so every stop holds 4.5:1 for the text.
 */
export const TILE_GRADIENT: Record<'coral' | 'sun' | 'mint' | 'sky', readonly [string, string, string]> = {
  // Toward a warmer pink-red.
  coral: ['#FF8A5C', palette.coral, '#FF4F6E'],
  // Toward amber-orange.
  sun: ['#FFD95A', palette.sun, '#FFA62B'],
  // Toward teal.
  mint: ['#7FEBC4', palette.mint, '#33C9B8'],
  // Toward periwinkle.
  sky: ['#9CCBFF', palette.sky, '#8F9BFF']
}

/** The CSS of a tile gradient: top-left light to bottom-right deep. */
export function tileGradient(tone: keyof typeof TILE_GRADIENT): string {
  const [light, base, deep] = TILE_GRADIENT[tone]
  return `linear-gradient(135deg, ${light} 0%, ${base} 45%, ${deep} 100%)`
}
