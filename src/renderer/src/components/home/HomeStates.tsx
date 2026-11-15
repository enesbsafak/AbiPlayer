import { useNavigate } from 'react-router-dom'
import { Activity, Plus, RefreshCw, Tv, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'
import { BOOTSTRAP_STAGES, type BootstrapStage } from '@/hooks/useHomeBootstrap'
import { toUserMessage } from '@/services/user-error'

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full p-3">
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border border-surface-800 bg-surface-900 px-6 text-center">
        {children}
      </div>
    </div>
  )
}

/** Shown before any source has been added. */
export function HomeWelcome() {
  const navigate = useNavigate()

  return (
    <Panel>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-20 items-center justify-center border border-accent/40 bg-accent/15">
          <Tv size={40} className="text-accent" />
        </div>
        <h1 className="text-2xl font-bold text-white">{APP_NAME}&apos;a Hoş Geldin</h1>
        <p className="rounded-md border border-surface-700 bg-surface-900 px-2.5 py-1 text-xs font-medium text-surface-400">
          {APP_VERSION_LABEL} sürümü test aşamasındadır.
        </p>
        <p className="max-w-md text-surface-300">
          İzlemeye başlamak için Xtream Codes sunucusuna bağlan veya bir M3U listesi içe aktar.
        </p>
        <Button size="lg" onClick={() => navigate('/settings')}>
          <Plus size={20} /> Kaynak Ekle
        </Button>
      </div>
    </Panel>
  )
}

interface HomeLoadingProps {
  /** True while sources are still connecting, before any catalog fetch starts. */
  isConnectingSources: boolean
  stage: BootstrapStage
  onRetry: () => void
}

export function HomeLoading({ isConnectingSources, stage, onRetry }: HomeLoadingProps) {
  const { message, progress } = BOOTSTRAP_STAGES[stage]
  const label = isConnectingSources ? 'Kaynaklar bağlanıyor...' : message
  const value = isConnectingSources ? 0.15 : progress

  return (
    <Panel>
      <Activity size={20} className="animate-pulse text-accent" />
      <p className="text-sm text-surface-300">{label}</p>
      <div
        className="h-1.5 w-48 overflow-hidden rounded-full bg-surface-800"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <p className="text-xs text-surface-500">
        {isConnectingSources ? 'Sunucu yanıtı bekleniyor' : 'Kategoriler ve ön izleme yükleniyor'}
      </p>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        <RefreshCw size={14} />
        Çok uzun sürüyor, yeniden dene
      </Button>
    </Panel>
  )
}

interface HomeErrorProps {
  message: string
  onRetry: () => void
  /** A second line, e.g. that the app keeps retrying on its own. */
  detail?: string
}

export function HomeError({ message, onRetry, detail }: HomeErrorProps) {
  const navigate = useNavigate()

  return (
    <Panel>
      <p className="text-sm font-medium text-white">Kaynağa bağlanılamadı</p>
      <p className="max-w-xl text-sm text-red-300">{toUserMessage(message, 'Bağlantı kurulamadı.')}</p>
      {detail && <p className="text-xs text-surface-400">{detail}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={onRetry}>
          <RefreshCw size={16} />
          Yeniden Dene
        </Button>
        <Button variant="secondary" onClick={() => navigate('/settings')}>
          Kaynak Ayarları
        </Button>
      </div>
    </Panel>
  )
}

interface HomeNoticeProps {
  message: string
  tone?: 'info' | 'error'
  onRetry?: () => void
  onDismiss?: () => void
}

/** A one-line notice above the dashboard rows: what did not load, or what is still loading. */
export function HomeNotice({ message, tone = 'error', onRetry, onDismiss }: HomeNoticeProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm ${
        tone === 'error'
          ? 'border-red-500/30 bg-red-500/10 text-red-200'
          : 'border-surface-700 bg-surface-900 text-surface-300'
      }`}
    >
      <p>{message}</p>
      <div className="flex shrink-0 items-center gap-1">
        {onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RefreshCw size={14} />
            Tekrar dene
          </Button>
        )}
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss} aria-label="Bildirimi kapat">
            <X size={14} />
          </Button>
        )}
      </div>
    </div>
  )
}
