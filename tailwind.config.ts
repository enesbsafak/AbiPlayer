import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b'
        },
        accent: {
          DEFAULT: '#7c6af7',
          50: '#f3f1fe',
          100: '#e9e5fd',
          200: '#d5ccfc',
          300: '#b8a9f9',
          400: '#9d84f8',
          500: '#7c6af7',
          600: '#6247ef',
          700: '#4f35d4',
          800: '#3e2aaa',
          900: '#342488'
        },
        signal: {
          DEFAULT: '#2dd4bf',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488'
        }
      },
      fontSize: {
        caption: ['10px', { lineHeight: '14px' }],
        label: ['11px', { lineHeight: '16px' }],
        'body-sm': ['13px', { lineHeight: '20px' }]
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif']
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
  plugins: []
}

export default config
