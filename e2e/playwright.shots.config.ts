// The README screenshots: the built app against the mock provider's demo
// catalog (e2e/mock-provider/demo.ts), drawn off-screen at 1280 × 800 and
// written to docs/images.
//
//   npm run shots

import { defineConfig } from '@playwright/test'
import { join } from 'node:path'
import { E2E_OUTPUT_DIR } from './support/paths.ts'

export default defineConfig({
  testDir: './shots',
  outputDir: join(E2E_OUTPUT_DIR, 'shots-results'),
  globalSetup: './shots/setup.ts',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']]
})
