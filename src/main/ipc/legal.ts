import type { LegalNoticeTarget } from '../../shared/ipc/contract'
import { mainStrings } from '../../shared/main-strings'
import { isLegalNoticeTarget } from '../legal-notices'
import type { IpcRegistrar } from './register'

export interface LegalHandlerDeps {
  /** Fixed path of the target, or null when it is not there (legal-notices.ts). */
  resolve: (target: LegalNoticeTarget) => string | null
  /** `shell.openPath`: resolves to '' on success, an error message otherwise. */
  openPath: (path: string) => Promise<string>
}

export function registerLegalHandlers(registrar: IpcRegistrar, deps: LegalHandlerDeps): void {
  registrar.handle('legal-open-notice', async (_event, target) => {
    if (!isLegalNoticeTarget(target)) throw new Error(mainStrings.invalid.legalNotice)
    const path = deps.resolve(target)
    if (!path) return false
    return (await deps.openPath(path)) === ''
  })
}
