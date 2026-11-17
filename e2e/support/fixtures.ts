import { test as base, expect } from '@playwright/test'
import { ensureMedia, type MediaSet } from '../mock-provider/media.ts'
import { startMockProvider, type MockOptions, type MockProvider } from '../mock-provider/server.ts'
import { startMockAddons, type MockAddons } from '../mock-provider/addons.ts'
import { launchApp, newProfileDir, removeProfileDir, type AbiApp, type CloseReport } from './app.ts'
import { E2E_CACHE_DIR } from './paths.ts'

export interface LaunchRequest {
  /** Reuse a profile from an earlier launch in the same test (restart scenarios). */
  profileDir?: string
  env?: Record<string, string>
  label?: string
}

interface TestFixtures {
  mockOptions: Omit<MockOptions, 'media'>
  mock: MockProvider
  /**
   * The fake catalogue and stream add-ons (mock-provider/addons.ts). Started
   * only by the scenarios that ask for it; their stream URLs redirect to the
   * mock provider's film file.
   */
  addons: MockAddons
  profileDir: string
  launch: (request?: LaunchRequest) => Promise<AbiApp>
  /** Close reports of every app this test launched, filled in during teardown or by `closeApp`. */
  closeReports: CloseReport[]
  closeApp: (app: AbiApp) => Promise<CloseReport>
}

interface WorkerFixtures {
  media: MediaSet
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  media: [
    async ({}, use) => {
      await use(await ensureMedia(E2E_CACHE_DIR))
    },
    { scope: 'worker' }
  ],

  mockOptions: [{}, { option: true }],

  mock: async ({ media, mockOptions }, use) => {
    const provider = await startMockProvider({ ...mockOptions, media })
    await use(provider)
    await provider.close()
  },

  addons: async ({ mock }, use) => {
    const credentials = `${encodeURIComponent(mock.username)}/${encodeURIComponent(mock.password)}`
    const addons = await startMockAddons({
      // Any film id plays the mock provider's film clip.
      mediaUrl: (token) => `${mock.url}/movie/${credentials}/100001.mp4?t=${encodeURIComponent(token)}`
    })
    await use(addons)
    await addons.close()
  },

  profileDir: async ({}, use) => {
    const dir = newProfileDir()
    await use(dir)
    removeProfileDir(dir)
  },

  closeReports: async ({}, use) => {
    await use([])
  },

  closeApp: async ({ closeReports }, use, testInfo) => {
    await use(async (app) => {
      const report = await app.close()
      closeReports.push(report)
      if (report.strays.length > 0) {
        testInfo.annotations.push({
          type: 'stray-processes',
          description: report.strays.map((stray) => `${stray.name} pid ${stray.pid}`).join(', ')
        })
      }
      return report
    })
  },

  launch: async ({ profileDir, closeApp }, use, testInfo) => {
    const open = new Set<AbiApp>()
    let count = 0
    await use(async (request = {}) => {
      count += 1
      const app = await launchApp({
        profileDir: request.profileDir ?? profileDir,
        env: request.env,
        outputDir: testInfo.outputDir,
        label: request.label ?? `launch${count}`
      })
      open.add(app)
      // Test mode must keep the window off every display and never take focus;
      // the owner works on this machine while the suite runs.
      await expect.poll(async () => (await app.windowPlacement()).visible, { timeout: 30_000 }).toBe(true)
      const placement = await app.windowPlacement()
      testInfo.annotations.push({
        type: 'window',
        description: `${app.label}: at ${placement.bounds.x},${placement.bounds.y} ${placement.bounds.width}x${placement.bounds.height}, on a display: ${placement.onAnyDisplay}, focused: ${placement.focused}`
      })
      if (placement.onAnyDisplay || placement.focused) {
        await app.close()
        throw new Error(`The app window is on screen or focused in test mode: ${JSON.stringify(placement)}`)
      }
      const originalClose = app.close.bind(app)
      app.close = async () => {
        open.delete(app)
        return originalClose()
      }
      return app
    })
    for (const app of open) {
      if (testInfo.status !== testInfo.expectedStatus) await app.shot('failure')
      await closeApp(app)
    }
  }
})

export { expect }
