// Runs the mock provider on its own, for poking at the app by hand:
//
//   node e2e/mock-provider/cli.ts --size medium --port 8089 --latency 80
//
// Options: --size small|medium|large, --port N, --latency MS,
// --bandwidth BYTES_PER_SEC, --no-cors, --auth ok|wrong-credentials|auth-as-string|expired.

import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ensureMedia } from './media.ts'
import { startMockProvider, type AuthBehaviour } from './server.ts'
import type { CatalogPreset } from './catalog.ts'
import { E2E_CACHE_DIR } from '../support/paths.ts'

const { values } = parseArgs({
  options: {
    size: { type: 'string', default: 'small' },
    port: { type: 'string', default: '8089' },
    latency: { type: 'string', default: '0' },
    bandwidth: { type: 'string' },
    'no-cors': { type: 'boolean', default: false },
    auth: { type: 'string', default: 'ok' }
  }
})

const media = await ensureMedia(join(E2E_CACHE_DIR))
const provider = await startMockProvider({
  media,
  size: values.size as CatalogPreset,
  port: Number(values.port),
  latencyMs: Number(values.latency),
  bandwidthBytesPerSec: values.bandwidth ? Number(values.bandwidth) : null,
  cors: !values['no-cors'],
  auth: values.auth as AuthBehaviour
})

console.log(`Mock provider: ${provider.url}`)
console.log(`  username: ${provider.username}`)
console.log(`  password: ${provider.password}`)
console.log(`  M3U:      ${provider.m3uUrl('ts')}`)
console.log(`  catalog:  ${provider.catalog.live.length} live, ${provider.catalog.vod.length} VOD, ${provider.catalog.series.length} series`)
console.log('Ctrl+C to stop.')

const stop = () => {
  void provider.close().then(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
