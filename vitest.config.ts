import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src/renderer/src')
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true
  }
})
