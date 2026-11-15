// The end-to-end scenarios tagged @packaged, against the unpacked package
// instead of the development build:
//
//   npm run build:unpack
//   npx playwright test -c e2e/playwright.packaged.config.ts
//
// Same harness, same off-screen and silent test mode; only the executable
// differs (e2e/support/paths.ts, E2E_TARGET).

import { defineConfig } from '@playwright/test'
import { join } from 'node:path'

// Read by e2e/support/paths.ts in this process and in the workers it starts.
process.env.ABI_E2E_TARGET = 'packaged'

const { E2E_OUTPUT_DIR } = await import('./support/paths.ts')
const { default: base } = await import('./playwright.config.ts')

export default defineConfig({
  ...base,
  grep: /@packaged/,
  outputDir: join(E2E_OUTPUT_DIR, 'packaged', 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: join(E2E_OUTPUT_DIR, 'packaged', 'results.json') }],
    ['html', { outputFolder: join(E2E_OUTPUT_DIR, 'packaged', 'report'), open: 'never' }]
  ]
})
