import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Mirrors the renderer define in electron.vite.config.ts — without it any test
// that reaches constants/app-info.ts dies on an undefined global.
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  version: string
}

// Üç proje: main/preload/shared Node ortamında, renderer jsdom'da, scripts/ Node'da.
// Kök ayarları (define, alias, mock temizliği) her projeye `extends: true` ile geçer.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src/renderer/src')
    }
  },
  test: {
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          environment: 'node',
          include: [
            'src/main/**/*.test.{ts,tsx}',
            'src/preload/**/*.test.{ts,tsx}',
            'src/shared/**/*.test.{ts,tsx}'
          ]
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}']
        }
      },
      {
        extends: true,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.{ts,mjs}']
        }
      }
    ]
  }
})
