import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#f6f9ff',
          100: '#e9f0ff',
          200: '#d2def2',
          300: '#b8c9e4',
          400: '#94abd0',
          500: '#758fb3',
          600: '#5a7498',
          700: '#435a7a',
          800: '#2f415c',
          900: '#1d2c43',
          950: '#101b30'
        },
        accent: {
          DEFAULT: '#6ea8ff',
          50: '#f0f6ff',
          100: '#deebff',
          200: '#c6ddff',
          300: '#a6c9ff',
          400: '#85b5ff',
          500: '#6ea8ff',
          600: '#588fe8',
          700: '#4374c8',
          800: '#345a9f',
          900: '#2a4a82'
        },
        signal: {
          DEFAULT: '#57d7c4',
          100: '#dcfff8',
          200: '#b8f6ea',
          300: '#92ebdc',
          400: '#71e0cf',
          500: '#57d7c4',
          600: '#3ab7a3',
          700: '#2d9686',
          800: '#26796d',
          900: '#225f56'
        }
      },
      fontFamily: {
        sans: ['SF Pro Text', 'SF Pro Display', 'Avenir Next', 'Segoe UI Variable Display', 'Trebuchet MS', 'sans-serif'],
        display: ['SF Pro Display', 'Avenir Next Demi Bold', 'Century Gothic', 'sans-serif']
      }
    }
  },
  plugins: []
}

export default config
