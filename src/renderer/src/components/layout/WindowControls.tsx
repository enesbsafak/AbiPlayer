import { useEffect, useState } from 'react'
import { CloseIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from '@/components/ui/icons'
import {
  isElectron,
  onWindowStateChange,
  windowClose,
  windowGetState,
  windowMaximize,
  windowMinimize
} from '@/services/platform'
import { strings } from '@/strings'

const text = strings.shell.window

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
    ? { title: text.restoreTitle, label: text.restoreLabel }
    : { title: text.maximizeTitle, label: text.maximizeLabel }
}

/** Round, raised, 44 px: the window buttons of both top bars. */
const CONTROL_BASE = 'no-drag flex size-11 shrink-0 items-center justify-center rounded-full bg-raised text-white transition-colors'
const CONTROL_BUTTON = `${CONTROL_BASE} hover:bg-surface-800`

/**
 * Minimize / maximize / close for the frameless window. Also drawn by the
 * full-screen error screens, so the window stays closable when the shell
 * itself is gone.
 */
export function WindowControls() {
  const maximized = useWindowMaximized()
  if (!isElectron()) return null
  const maximizeText = maximizeButtonText(maximized)

  return (
    <div className="no-drag flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={windowMinimize}
        title={text.minimizeTitle}
        aria-label={text.minimizeLabel}
        className={CONTROL_BUTTON}
      >
        <MinimizeIcon size={18} />
      </button>
      <button
        type="button"
        onClick={windowMaximize}
        title={maximizeText.title}
        aria-label={maximizeText.label}
        aria-pressed={maximized}
        className={CONTROL_BUTTON}
      >
        {maximized ? <RestoreIcon size={18} /> : <MaximizeIcon size={18} />}
      </button>
      <button
        type="button"
        onClick={windowClose}
        title={text.closeTitle}
        aria-label={text.closeLabel}
        className={`${CONTROL_BASE} hover:bg-coral hover:text-ink`}
      >
        <CloseIcon size={18} />
      </button>
    </div>
  )
}
