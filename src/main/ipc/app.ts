import {
  checkForAppUpdates,
  deleteStoreBackup,
  getAppUpdateState,
  installDownloadedUpdate,
  readStoreBackup
} from '../app-updater'
import { setPreventDisplaySleep } from '../display-sleep'
import type { IpcRegistrar } from './register'
import { requireBoolean } from './validators'
import { mainStrings } from '../../shared/main-strings'

export function registerAppHandlers(registrar: IpcRegistrar): void {
  registrar.handle('display-sleep-set-prevented', (_event, prevented) => {
    setPreventDisplaySleep(requireBoolean(prevented, mainStrings.invalid.displaySleep))
  })

  registrar.handle('app-update-get-state', () => getAppUpdateState())
  registrar.handle('app-update-check', () => checkForAppUpdates())
  registrar.handle('app-update-install', () => installDownloadedUpdate())

  registrar.handle('store-backup-read', () => readStoreBackup())
  registrar.handle('store-backup-delete', () => deleteStoreBackup())
}
