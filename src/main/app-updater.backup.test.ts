// @vitest-environment node
import { tmpdir } from 'os'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0', getPath: () => tmpdir(), isPackaged: false, once: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showMessageBox: vi.fn() }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { RENDERER_STORE_BACKUP_SCRIPT } = await import('./app-updater')

/** Runs the script the way `executeJavaScript` would, against a fake page. */
function runInPage(page: { window: Record<string, unknown>; localStorage: { getItem(key: string): string | null } }) {
  return new Function('window', 'localStorage', `return ${RENDERER_STORE_BACKUP_SCRIPT}`)(
    page.window,
    page.localStorage
  ) as unknown
}

describe('store backup before an update', () => {
  it('flushes the pending store write before reading it', () => {
    let stored = '{"version":1}'
    const page = {
      window: { __abiPlayerFlushStore: () => (stored = '{"version":2}') } as Record<string, unknown>,
      localStorage: { getItem: () => stored }
    }

    expect(runInPage(page)).toBe('{"version":2}')
  })

  it('still reads the store on a page without the flush hook', () => {
    expect(runInPage({ window: {}, localStorage: { getItem: () => 'x' } })).toBe('x')
  })
})
