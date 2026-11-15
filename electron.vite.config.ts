import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version)
    },
    plugins: [react()],
    // The catalog worker (src/renderer/src/workers) is a module worker: an ES
    // chunk next to the page's, loaded from the same origin, so the CSP's
    // `worker-src 'self'` covers it (no blob: URL).
    worker: {
      format: 'es'
    },
    // electron-vite leaves the renderer unminified by default (F5-07). Source
    // maps stay off: nothing in the package reads them.
    build: {
      minify: true,
      sourcemap: false
    },
    css: {
      postcss: resolve(__dirname, 'postcss.config.js')
    }
  }
})
