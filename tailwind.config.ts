import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'
import { palette, surfaceScale } from './src/renderer/src/theme/palette'

const config: Config = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Canlı renk" (docs/tasarim): see src/renderer/src/theme/palette.ts.
        ground: palette.ground,
        raised: palette.raised,
        deep: palette.deep,
        ink: palette.ink,
        coral: palette.coral,
        sun: palette.sun,
        mint: palette.mint,
        sky: palette.sky,
        surface: surfaceScale,
        // The old violet accent, remapped: highlights, progress, selected
        // items and focus rings are sun now. Pages still written against
        // `accent` pick it up without being rewritten.
        accent: {
          DEFAULT: palette.sun,
          600: '#F0B526'
        },
        // "Connected / on".
        signal: {
          DEFAULT: palette.mint,
          400: palette.mint,
          500: '#3FCF9E',
          600: '#2BB386'
        }
      },
      borderRadius: {
        // Tiles 28, rows and cards 20, posters 20, pills fully round.
        tile: '28px',
        card: '20px'
      },
      fontSize: {
        caption: ['10px', { lineHeight: '14px' }],
        label: ['11px', { lineHeight: '16px' }],
        'body-sm': ['13px', { lineHeight: '20px' }]
      },
      fontFamily: {
        sans: ['"DM Sans Variable"', '"DM Sans"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque Variable"', '"Bricolage Grotesque"', '"DM Sans Variable"', 'sans-serif']
      },
      zIndex: {
        'loading': '20',
        'sidebar': '30',
        'titlebar': '40',
        'dropdown': '45',
        'overlay': '50',
        'modal': '55'
      }
    }
  },
  plugins: [
    // `short:` for a short window (the smallest is 900 × 600): the home
    // screen's tiles and posters shrink so it still fits without scrolling. A
    // variant rather than a raw screen: a raw screen would switch off the
    // max-* screen variants the top bars use.
    plugin(({ addVariant }) => addVariant('short', '@media (max-height: 720px)'))
  ]
}

export default config
