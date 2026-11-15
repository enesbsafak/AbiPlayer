// End-to-end suite: the built app (out/) against the local mock provider.
//
//   npm run test:e2e                       build, then every scenario
//   npx playwright test -c e2e/playwright.config.ts tests/03-live-playback.spec.ts
//   npx playwright test -c e2e/playwright.config.ts -g "kanal değiştir"
//
// Each test launches its own app with a fresh temp profile and its own mock
// provider, so scenarios are independent. One worker: every test drives a real
// window and a real mpv, and two at once would fight over focus and CPU.

import { defineConfig } from '@playwright/test'
import { join } from 'node:path'
import { E2E_OUTPUT_DIR } from './support/paths.ts'

export default defineConfig({
  testDir: './tests',
  outputDir: join(E2E_OUTPUT_DIR, 'test-results'),
  globalSetup: './global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['json', { outputFile: join(E2E_OUTPUT_DIR, 'results.json') }],
    ['html', { outputFolder: join(E2E_OUTPUT_DIR, 'report'), open: 'never' }]
  ]
})
