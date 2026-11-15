import { useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { useAppUpdate } from '@/hooks/useAppUpdate'
import type { AppUpdateState } from '@/services/platform'

function formatUpdateTimestamp(timestamp: number | null): string {
  if (!timestamp) return 'Henüz kontrol edilmedi'
  return new Date(timestamp).toLocaleString('tr-TR')
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
      return 'Bu ortamda otomatik güncelleme desteklenmiyor'
    case 'idle':
      return 'Güncelleme sistemi hazır'
    case 'checking':
      return 'Güncellemeler kontrol ediliyor...'
    case 'available':
      return 'Yeni sürüm bulundu, indirme başlatıldı'
    case 'downloading':
      return 'Güncelleme indiriliyor...'
    case 'downloaded':
      return 'Güncelleme indirildi, kurulum için yeniden başlatın'
    case 'not-available':
      return 'Uygulama güncel'
    case 'error':
      return 'Güncelleme kontrolünde hata oluştu'
    default:
      return 'Güncelleme durumu alınıyor...'
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

    const parts = [`%${Math.round((appUpdateState.progress ?? 0) * 100)}`]
    if (transferred && total) parts.push(`${transferred} / ${total}`)
    if (speed) parts.push(`${speed}/sn`)
    return parts.join(' | ')
  }, [appUpdateState])

  return (
    <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-white">
            Sürüm {appUpdateState?.currentVersion ?? '...'}
            {appUpdateState?.availableVersion &&
            appUpdateState.availableVersion !== appUpdateState.currentVersion
              ? ` → ${appUpdateState.availableVersion}`
              : ''}
          </p>
          <p className="text-sm text-surface-300">{getUpdateStatusLabel(appUpdateState)}</p>
          {appUpdateState?.message && (
            <p className="text-xs text-surface-500">{appUpdateState.message}</p>
          )}
          {checkError && <p className="text-xs text-red-400">{checkError}</p>}
          <p className="text-xs text-surface-500">
            Son kontrol: {formatUpdateTimestamp(appUpdateState?.lastCheckedAt ?? null)}
          </p>
        </div>

        {appUpdateState?.status === 'downloading' && (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-surface-800">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round((appUpdateState.progress ?? 0) * 100)}%` }}
              />
            </div>
            {updateProgressLabel && (
              <p className="text-xs text-surface-500">{updateProgressLabel}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => void check()}
            disabled={
              !appUpdateState?.canCheck ||
              isCheckingUpdates ||
              appUpdateState?.status === 'downloading'
            }
          >
            {isCheckingUpdates || appUpdateState?.status === 'checking'
              ? 'Kontrol ediliyor...'
              : 'Güncellemeleri Kontrol Et'}
          </Button>

          {appUpdateState?.updateReadyToInstall && (
            <Button onClick={() => void install()} disabled={isInstallingUpdate}>
              {isInstallingUpdate ? 'Yeniden başlatılıyor...' : 'Yeniden Başlat ve Yükle'}
            </Button>
          )}
        </div>

        {appUpdateState?.releaseDate && (
          <p className="text-xs text-surface-500">
            Yeni sürüm tarihi: {new Date(appUpdateState.releaseDate).toLocaleString('tr-TR')}
          </p>
        )}
      </div>
    </div>
  )
}
