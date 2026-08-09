import { Minus, X, Maximize2, Download, Loader2 } from 'lucide-react'
import { isElectron, windowMinimize, windowMaximize, windowClose } from '@/services/platform'
import { useAppUpdate } from '@/hooks/useAppUpdate'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'

const BADGE_BASE =
  'flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-caption font-medium transition-colors'
const BADGE_IDLE = 'border-surface-700 bg-surface-900 text-surface-500'

/**
 * The version badge was dead pixels on every screen; it now doubles as the
 * updater surface so checking for a new build never means opening settings.
 * The updater already polls on its own — this only exposes the manual path and
 * whatever it is currently doing.
 */
function UpdateBadge() {
  const { state, isChecking, isInstalling, check, install } = useAppUpdate()
  const checking = isChecking || state?.status === 'checking'

  if (state?.updateReadyToInstall) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        disabled={isInstalling}
        title="Güncellemeyi kurmak için yeniden başlat"
        className={`${BADGE_BASE} border-accent/45 bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-60`}
      >
        <Download size={11} />
        {isInstalling ? 'Yeniden başlatılıyor...' : 'Güncelle'}
      </button>
    )
  }

  if (state?.status === 'downloading') {
    return (
      <span className={`${BADGE_BASE} border-accent/35 bg-accent/10 text-accent`}>
        %{Math.round((state.progress ?? 0) * 100)} indiriliyor
      </span>
    )
  }

  const canCheck = state?.canCheck === true

  return (
    <button
      type="button"
      onClick={() => void check()}
      disabled={!canCheck || checking}
      title={
        canCheck
          ? 'Güncellemeleri kontrol et'
          : 'Otomatik güncelleme yalnızca kurulu uygulamada çalışır'
      }
      className={`${BADGE_BASE} ${BADGE_IDLE} ${
        canCheck && !checking ? 'hover:border-surface-600 hover:text-surface-300' : ''
      }`}
    >
      {checking && <Loader2 size={11} className="animate-spin" />}
      {checking ? 'Kontrol ediliyor' : APP_VERSION_LABEL}
    </button>
  )
}

export function TitleBar() {
  if (!isElectron()) return null

  return (
    <div className="drag-region relative z-titlebar flex h-11 items-center justify-between border-b border-surface-800 bg-surface-950 px-4">
      <div className="no-drag flex items-center gap-2.5">
        <span className="text-body-sm font-semibold text-surface-50">{APP_NAME}</span>
        <UpdateBadge />
      </div>

      <div className="no-drag flex items-center">
        <button
          type="button"
          onClick={windowMinimize}
          title="Asagi Al"
          aria-label="Pencereyi asagi al"
          className="flex h-8 w-10 items-center justify-center text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          onClick={windowMaximize}
          title="Boyut Degistir"
          aria-label="Pencere boyutunu degistir"
          className="flex h-8 w-10 items-center justify-center text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
        >
          <Maximize2 size={12} />
        </button>
        <button
          type="button"
          onClick={windowClose}
          title="Kapat"
          aria-label="Pencereyi kapat"
          className="flex h-8 w-10 items-center justify-center text-surface-400 transition-colors hover:bg-red-600 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
