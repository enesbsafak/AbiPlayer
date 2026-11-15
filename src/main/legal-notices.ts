import { win32 } from 'path'
import type { LegalNoticeTarget } from '../shared/ipc/contract'

export interface LegalNoticeEnvironment {
  /** `app.isPackaged`: false for `electron-vite dev` and the test harness. */
  isPackaged: boolean
  /** `process.resourcesPath`; undefined outside Electron. */
  resourcesPath?: string
  /** Directory of the main-process bundle (`out/main` in dev). */
  appDir: string
  cwd: string
  exists: (candidate: string) => boolean
}

/** Renderer arguments arrive untyped; only these two names are accepted. */
export function isLegalNoticeTarget(value: unknown): value is LegalNoticeTarget {
  return value === 'notices' || value === 'licenses'
}

function candidates(env: LegalNoticeEnvironment, target: LegalNoticeTarget): string[] {
  // electron-builder.yml copies THIRD-PARTY-NOTICES.md to
  // <resources>/legal/THIRD-PARTY-NOTICES.txt and licenses/ to
  // <resources>/legal/licenses.
  if (env.isPackaged) {
    if (!env.resourcesPath) return []
    const shipped = target === 'notices' ? ['THIRD-PARTY-NOTICES.txt'] : ['licenses']
    return [win32.join(env.resourcesPath, 'legal', ...shipped)]
  }
  const inCheckout = target === 'notices' ? 'THIRD-PARTY-NOTICES.md' : 'licenses'
  return [win32.join(env.appDir, '..', '..', inCheckout), win32.join(env.cwd, inCheckout)]
}

/**
 * The absolute path of the third-party notices file or the licence folder,
 * or null when it is not there. Fixed paths only: the renderer names one of
 * two targets and never a path, and a packaged build only looks next to the
 * app.
 */
export function resolveLegalNoticePath(env: LegalNoticeEnvironment, target: LegalNoticeTarget): string | null {
  return candidates(env, target).find((candidate) => env.exists(candidate)) ?? null
}
