import { useMemo } from 'react'
import { ACTION, FieldError, SettingsCard, SettingsGroup } from './controls'
import { useAppUpdate } from '@/hooks/useAppUpdate'
import type { AppUpdateState } from '@/services/platform'
import { LOCALE, strings } from '@/strings'

const text = strings.settings.updates

function formatUpdateTimestamp(timestamp: number | null): string {
  if (!timestamp) return text.neverChecked
  return new Date(timestamp).toLocaleString(LOCALE)
}

function formatBytes(value: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null

  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const precision = unitIndex === 0 ? 0 : 1
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}

function getUpdateStatusLabel(updateState: AppUpdateState | null): string {
  switch (updateState?.status) {
    case 'unsupported':
      return text.status.unsupported
    case 'idle':
      return text.status.idle
    case 'checking':
      return text.status.checking
    case 'available':
      return text.status.available
    case 'downloading':
      return text.status.downloading
    case 'downloaded':
      return text.status.downloaded
    case 'not-available':
      return text.status.notAvailable
    case 'error':
      return text.status.error
    default:
      return text.status.unknown
  }
}

export function UpdateSettings() {
  const {
    state: appUpdateState,
    isChecking: isCheckingUpdates,
    isInstalling: isInstallingUpdate,
    checkError,
    check,
    install
  } = useAppUpdate()

  const updateProgressLabel = useMemo(() => {
    if (!appUpdateState || appUpdateState.status !== 'downloading') return null
    const transferred = formatBytes(appUpdateState.transferredBytes)
    const total = formatBytes(appUpdateState.totalBytes)
    const speed = formatBytes(appUpdateState.bytesPerSecond)

    const parts = [text.percent(appUpdateState.progress ?? 0)]
    if (transferred && total) parts.push(`${transferred} / ${total}`)
    if (speed) parts.push(text.perSecond(speed))
    return parts.join(' | ')
  }, [appUpdateState])

  const readyToInstall = appUpdateState?.updateReadyToInstall === true
  const status = appUpdateState?.status
  // Mint once there is nothing to do or the update waits; sun while it moves.
  const statusDot =
    status === 'not-available' || status === 'downloaded'
      ? 'bg-mint'
      : status === 'error'
        ? 'bg-coral'
        : status === 'checking' || status === 'downloading' || status === 'available'
          ? 'bg-sun'
          : 'bg-surface-600'
  const percent = Math.round((appUpdateState?.progress ?? 0) * 100)

  return (
    <SettingsGroup title={text.group}>
      <SettingsCard>
        <div className="flex min-w-0 flex-col gap-4 px-5 py-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="font-title text-[28px] leading-[1.15]">
              {text.version(appUpdateState?.currentVersion)}
              {appUpdateState?.availableVersion && appUpdateState.availableVersion !== appUpdateState.currentVersion
                ? ` → ${appUpdateState.availableVersion}`
                : ''}
            </p>
            <p className="flex items-center gap-2.5 text-base text-white">
              <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${statusDot}`} />
              {getUpdateStatusLabel(appUpdateState)}
            </p>
            {appUpdateState?.message && <p className="text-sm text-surface-400">{appUpdateState.message}</p>}
            {checkError && <FieldError>{checkError}</FieldError>}
            <p className="text-sm text-surface-400">
              {text.lastChecked(formatUpdateTimestamp(appUpdateState?.lastCheckedAt ?? null))}
            </p>
            {appUpdateState?.releaseDate && (
              <p className="text-sm text-surface-400">
                {text.releaseDate(new Date(appUpdateState.releaseDate).toLocaleString(LOCALE))}
              </p>
            )}
          </div>

          {status === 'downloading' && (
            <div className="flex flex-col gap-2">
              <div
                className="h-3 overflow-hidden rounded-full bg-ground"
                role="progressbar"
                aria-label={text.downloadProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div className="h-full rounded-full bg-sun transition-[width]" style={{ width: `${percent}%` }} />
              </div>
              {updateProgressLabel && <p className="text-sm text-surface-400">{updateProgressLabel}</p>}
            </div>
          )}

          {/* One white action: installing once it is ready, checking otherwise. */}
          <div className="flex flex-wrap items-center gap-3">
            {readyToInstall && (
              <button type="button" className={ACTION.primary} onClick={() => void install()} disabled={isInstallingUpdate}>
                {isInstallingUpdate ? text.restarting : text.restartAndInstall}
              </button>
            )}
            <button
              type="button"
              className={readyToInstall ? ACTION.secondary : ACTION.primary}
              onClick={() => void check()}
              disabled={!appUpdateState?.canCheck || isCheckingUpdates || status === 'downloading'}
            >
              {isCheckingUpdates || status === 'checking' ? text.checking : text.check}
            </button>
          </div>
        </div>
      </SettingsCard>
    </SettingsGroup>
  )
}
