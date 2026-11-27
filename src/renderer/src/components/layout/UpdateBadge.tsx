import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Download, Loader2 } from 'lucide-react'
import type { AppUpdateState } from '@/services/platform'
import { useAppUpdate } from '@/hooks/useAppUpdate'
import { APP_VERSION_LABEL } from '@/constants/app-info'
import { strings } from '@/strings'

const text = strings.shell

const OUTCOME_VISIBLE_MS = 4000

export interface CheckOutcome {
  tone: 'ok' | 'update' | 'error'
  text: string
}

/**
 * What a finished manual check should briefly say on the badge. Without it a
 * click ended with the badge looking exactly as before, whatever happened.
 */
export function describeCheckOutcome(
  state: AppUpdateState | null,
  checkError: string | null
): CheckOutcome | null {
  if (checkError) return { tone: 'error', text: checkError }
  switch (state?.status) {
    case 'not-available':
      return { tone: 'ok', text: text.update.upToDate }
    case 'available':
    case 'downloading':
    case 'downloaded':
      return { tone: 'update', text: text.update.available }
    case 'error':
      return { tone: 'error', text: state.message || text.update.checkFailed }
    default:
      return null
  }
}

const PILL = 'flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition-colors'

// Filled with the colour that means it, ink on top: mint is "on / fine", sun
// a highlight, coral the one that needs attention.
const OUTCOME_CLASSES: Record<CheckOutcome['tone'], string> = {
  ok: 'bg-mint text-ink',
  update: 'bg-sun text-ink',
  error: 'bg-coral text-ink'
}

const UPDATE_SETTINGS_ROUTE = '/settings?tab=updates'

/** "Güncelle" when an update is downloaded and waiting: shown in both top bars. */
export function UpdateReadyPill() {
  const navigate = useNavigate()
  const { state, isInstalling, install } = useAppUpdate()
  // Its install did not go through before: pressing "Güncelle" again would
  // only close the app once more. The settings page says what to do.
  if (state?.installBlocked) {
    return (
      <button
        type="button"
        onClick={() => void navigate(UPDATE_SETTINGS_ROUTE)}
        title={text.update.blockedTitle}
        className="no-drag flex h-11 shrink-0 items-center gap-2 rounded-full bg-coral px-4 text-sm font-bold text-ink"
      >
        <AlertCircle size={16} aria-hidden="true" />
        {text.update.blocked}
      </button>
    )
  }
  if (!state?.updateReadyToInstall) return null
  return (
    <button
      type="button"
      onClick={() => void install()}
      disabled={isInstalling}
      title={text.update.installTitle}
      className="no-drag flex h-11 shrink-0 items-center gap-2 rounded-full bg-sun px-4 text-sm font-bold text-ink disabled:opacity-60"
    >
      <Download size={16} aria-hidden="true" />
      {isInstalling ? text.update.restarting : text.update.install}
    </button>
  )
}

/**
 * The version, which doubles as the updater surface: a click checks for a new
 * build, so that never means opening settings. The updater already polls on
 * its own; this only exposes the manual path and what it is doing now.
 */
export function UpdateBadge() {
  const navigate = useNavigate()
  const { state, isChecking, isInstalling, checkError, check, install } = useAppUpdate()
  const checking = isChecking || state?.status === 'checking'
  const awaitingOutcomeRef = useRef(false)
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null)

  useEffect(() => {
    if (!awaitingOutcomeRef.current || checking) return
    awaitingOutcomeRef.current = false
    setOutcome(describeCheckOutcome(state, checkError))
  }, [checking, state, checkError])

  useEffect(() => {
    if (!outcome) return
    const timer = setTimeout(() => setOutcome(null), OUTCOME_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [outcome])

  if (state?.installBlocked) {
    return (
      <button
        type="button"
        onClick={() => void navigate(UPDATE_SETTINGS_ROUTE)}
        title={text.update.blockedTitle}
        className={`${PILL} bg-coral text-ink`}
      >
        <AlertCircle size={13} aria-hidden="true" />
        {text.update.blocked}
      </button>
    )
  }

  if (state?.updateReadyToInstall) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        disabled={isInstalling}
        title={text.update.installTitle}
        className={`${PILL} bg-sun text-ink disabled:opacity-60`}
      >
        <Download size={13} aria-hidden="true" />
        {isInstalling ? text.update.restarting : text.update.install}
      </button>
    )
  }

  if (state?.status === 'downloading') {
    return <span className={`${PILL} bg-raised text-sun`}>{text.update.downloading(state.progress ?? 0)}</span>
  }

  const canCheck = state?.canCheck === true

  return (
    <button
      type="button"
      onClick={() => {
        awaitingOutcomeRef.current = true
        setOutcome(null)
        void check()
      }}
      disabled={!canCheck || checking}
      title={outcome?.text ?? (canCheck ? text.update.checkTitle : text.update.installedOnly)}
      aria-live="polite"
      className={`${PILL} ${outcome ? OUTCOME_CLASSES[outcome.tone] : 'bg-raised text-surface-500'} ${
        canCheck && !checking && !outcome ? 'hover:bg-surface-800 hover:text-white' : ''
      }`}
    >
      {checking && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
      <span className="max-w-[260px] truncate">
        {checking ? text.update.checking : (outcome?.text ?? APP_VERSION_LABEL)}
      </span>
    </button>
  )
}
