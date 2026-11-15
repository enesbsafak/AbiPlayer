import { useEffect, useRef, useState } from 'react'
import { Minus, X, Maximize2, Minimize2, Download, Loader2 } from 'lucide-react'
import {
  isElectron,
  onWindowStateChange,
  windowClose,
  windowGetState,
  windowMaximize,
  windowMinimize
} from '@/services/platform'
import type { AppUpdateState } from '@/services/platform'
import { useAppUpdate } from '@/hooks/useAppUpdate'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'

const BADGE_BASE =
  'flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-caption font-medium transition-colors'
const BADGE_IDLE = 'border-surface-700 bg-surface-900 text-surface-500'
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
      return { tone: 'ok', text: 'Güncel' }
    case 'available':
    case 'downloading':
    case 'downloaded':
      return { tone: 'update', text: 'Güncelleme var' }
    case 'error':
      return { tone: 'error', text: state.message || 'Güncelleme denetlenemedi' }
    default:
      return null
  }
}

const OUTCOME_CLASSES: Record<CheckOutcome['tone'], string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  update: 'border-accent/45 bg-accent/15 text-accent',
  error: 'border-red-500/40 bg-red-500/10 text-red-300'
}

/**
 * The version badge was dead pixels on every screen; it now doubles as the
 * updater surface so checking for a new build never means opening settings.
 * The updater already polls on its own — this only exposes the manual path and
 * whatever it is currently doing.
 */
function UpdateBadge() {
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
      onClick={() => {
        awaitingOutcomeRef.current = true
        setOutcome(null)
        void check()
      }}
      disabled={!canCheck || checking}
      title={
        outcome?.text ??
        (canCheck
          ? 'Güncellemeleri kontrol et'
          : 'Otomatik güncelleme yalnızca kurulu uygulamada çalışır')
      }
      aria-live="polite"
      className={`${BADGE_BASE} ${outcome ? OUTCOME_CLASSES[outcome.tone] : BADGE_IDLE} ${
        canCheck && !checking && !outcome ? 'hover:border-surface-600 hover:text-surface-300' : ''
      }`}
    >
      {checking && <Loader2 size={11} className="animate-spin" />}
      <span className="max-w-[260px] truncate">
        {checking ? 'Kontrol ediliyor' : (outcome?.text ?? APP_VERSION_LABEL)}
      </span>
    </button>
  )
}

const CONTROL_BUTTON =
  'flex h-8 w-10 items-center justify-center text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50'

/**
 * Whether the window is maximized, as main reports it: read once, then
 * followed through its state events (the button, a double click on the bar,
 * Windows snapping and keyboard shortcuts all go through them).
 */
export function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    let active = true
    // The first read can answer after an event; the event is newer then.
    let eventSeen = false
    const stop = onWindowStateChange((state) => {
      eventSeen = true
      setMaximized(state.isMaximized)
    })
    void windowGetState()
      .then((state) => {
        if (active && state && !eventSeen) setMaximized(state.isMaximized)
      })
      .catch(() => undefined)
    return () => {
      active = false
      stop?.()
    }
  }, [])
  return maximized
}

/** The maximize button's label follows what a click would do. */
export function maximizeButtonText(maximized: boolean): { title: string; label: string } {
  return maximized
    ? { title: 'Önceki Boyut', label: 'Pencereyi önceki boyutuna getir' }
    : { title: 'Büyüt', label: 'Pencereyi büyüt' }
}

/**
 * Minimize / maximize / close for the frameless window. Exported so the
 * full-screen error screens can keep the window closable when the shell itself
 * is gone.
 */
export function WindowControls() {
  const maximized = useWindowMaximized()
  if (!isElectron()) return null
  const maximizeText = maximizeButtonText(maximized)

  return (
    <div className="no-drag flex items-center">
      <button
        type="button"
        onClick={windowMinimize}
        title="Aşağı Al"
        aria-label="Pencereyi aşağı al"
        className={CONTROL_BUTTON}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        onClick={windowMaximize}
        title={maximizeText.title}
        aria-label={maximizeText.label}
        aria-pressed={maximized}
        className={CONTROL_BUTTON}
      >
        {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
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
  )
}

// A double click on the bar is handled in main (src/main/ipc/window.ts): the
// bar is a drag region, and on Windows a drag region of this frameless,
// transparent window never delivers DOM mouse events.
export function TitleBar() {
  if (!isElectron()) return null

  return (
    <div className="drag-region relative z-titlebar flex h-11 items-center justify-between border-b border-surface-800 bg-surface-950 px-4">
      <div className="no-drag flex items-center gap-2.5">
        <span className="text-body-sm font-semibold text-surface-50">{APP_NAME}</span>
        <UpdateBadge />
      </div>

      <WindowControls />
    </div>
  )
}
