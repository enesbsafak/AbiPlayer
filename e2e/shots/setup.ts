import globalSetup from '../global-setup.ts'
import { ensureDemoLive } from '../mock-provider/media.ts'
import { E2E_CACHE_DIR } from '../support/paths.ts'

/** The e2e checks and clips, and the demo's full-HD live clip. */
export default async function shotsSetup(): Promise<void> {
  await globalSetup()
  await ensureDemoLive(E2E_CACHE_DIR)
}
