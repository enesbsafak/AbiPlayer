import { useNavigate } from 'react-router-dom'
import { AlertCircle, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'
import { BOOTSTRAP_STAGES, type BootstrapStage } from '@/hooks/useHomeBootstrap'
import { toUserMessage } from '@/services/user-error'
import { strings } from '@/strings'
import { FEATURE_TILE, PRIMARY_PILL, SECONDARY_PILL } from './home-ui'

const text = strings.catalog.home

/*
 * The states the large home tile takes before there is anything to watch:
 * nothing configured yet, the source still loading, and the source failing.
 * Each keeps the tile's place, so the destination tiles beside it stay put.
 */

/** Shown before any source has been added. */
export function HomeWelcome() {
  const navigate = useNavigate()

  return (
    <section aria-labelledby="home-welcome" className={`${FEATURE_TILE} flex flex-col justify-between gap-6 p-7 short:p-6`}>
      <div aria-hidden="true" className="grid size-[72px] grid-cols-2 gap-2 short:size-14">
        <span className="rounded-[14px] bg-coral" />
        <span className="rounded-[14px] bg-sun" />
        <span className="rounded-[14px] bg-mint" />
        <span className="rounded-[14px] bg-sky" />
      </div>
      <div className="flex flex-col items-start gap-4">
        <h2 id="home-welcome" className="font-title text-[clamp(32px,min(6.5vh,4.2vw),54px)] tracking-[-0.035em]">
          {text.welcome(APP_NAME)}
        </h2>
        <p className="max-w-md text-lg text-surface-400">{text.welcomeHint}</p>
        <p className="rounded-full bg-ground px-3.5 py-1.5 text-sm font-medium text-surface-500">
          {text.betaNotice(APP_VERSION_LABEL)}
        </p>
        <button type="button" onClick={() => void navigate('/settings?tab=sources')} className={`${PRIMARY_PILL} mt-2`}>
          {strings.common.addSource}
        </button>
      </div>
    </section>
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
  const label = isConnectingSources ? text.connectingSources : message
  const value = isConnectingSources ? 0.15 : progress

  return (
    <section aria-labelledby="home-loading" className={`${FEATURE_TILE} flex flex-col justify-end gap-5 p-7 short:p-6`}>
      <h2 id="home-loading" className="font-title text-[clamp(28px,min(5.5vh,3.6vw),44px)]">
        {label}
      </h2>
      <div
        className="h-3 w-full overflow-hidden rounded-md bg-white/20"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <div
          className="h-full rounded-md bg-sun transition-[width] duration-500"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <p className="text-base text-surface-400">
        {isConnectingSources ? text.waitingForServer : text.loadingPreview}
      </p>
      <button type="button" onClick={onRetry} className={`${SECONDARY_PILL} self-start`}>
        <RefreshCw size={18} className="mr-2.5" aria-hidden="true" />
        {text.tooSlowRetry}
      </button>
    </section>
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
    <section
      role="alert"
      aria-labelledby="home-error"
      className={`${FEATURE_TILE} flex flex-col justify-end gap-4 p-7 short:p-6`}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-coral text-ink">
        <AlertCircle size={30} strokeWidth={2.4} aria-hidden="true" />
      </span>
      <h2 id="home-error" className="font-title text-[clamp(28px,min(5.5vh,3.6vw),44px)]">
        {text.connectFailed}
      </h2>
      <p className="max-w-xl text-base text-surface-300">{toUserMessage(message, text.connectFailedFallback)}</p>
      {detail && <p className="text-sm text-surface-500">{detail}</p>}
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" onClick={onRetry} className={PRIMARY_PILL}>
          <RefreshCw size={20} aria-hidden="true" />
          {strings.common.retry}
        </button>
        <button type="button" onClick={() => void navigate('/settings?tab=sources')} className={SECONDARY_PILL}>
          {strings.common.sourceSettings}
        </button>
      </div>
    </section>
  )
}

interface HomeNoticeProps {
  message: string
  tone?: 'info' | 'error'
  onRetry?: () => void
  onDismiss?: () => void
}

/** A one-line notice above the tiles: what did not load, or what is still loading. */
export function HomeNotice({ message, tone = 'error', onRetry, onDismiss }: HomeNoticeProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="flex items-center justify-between gap-3 rounded-card bg-raised py-2 pl-5 pr-2 text-sm text-white"
    >
      <p className="flex items-center gap-3">
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${tone === 'error' ? 'bg-coral' : 'bg-sun'}`} />
        {message}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        {onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            {strings.common.retry}
          </Button>
        )}
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss} aria-label={strings.common.dismissNotice}>
            <X size={14} aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )
}
