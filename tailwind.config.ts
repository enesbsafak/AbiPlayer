import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#f5f5fa',
          100: '#eaeaf4',
          200: '#d0d0e6',
          300: '#adadcc',
          400: '#8585aa',
          500: '#636388',
          600: '#4b4b6c',
          700: '#363650',
          800: '#222236',
          900: '#131325',
          950: '#0b0b1a'
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
          100: '#ccfdf7',
          200: '#99f9ef',
          300: '#5ef0e5',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a'
        }
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}

export default config
