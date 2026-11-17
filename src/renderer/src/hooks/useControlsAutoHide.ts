import { useCallback, useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react'
import { ControlsAutoHide } from '@/components/player/controls-autohide'

/** What marks the player's controls (the top row and the dock). */
const CONTROLS_SELECTOR = '[data-player-controls]'
/** A dock menu or picker that is open (each one's trigger says so). */
const OPEN_MENU_SELECTOR = '[aria-expanded="true"]'

interface ControlsAutoHideInput {
  /** Receives every change; the store's `setShowControls`. */
  setVisible: (visible: boolean) => void
  isSidebarOpen: boolean
  /** An error is shown in place of the picture: nothing is playing to hide the controls for. */
  hasError: boolean
}

/**
 * Wires `ControlsAutoHide` to the player: the pointer over the player, focus
 * and open menus inside the controls, the channel list. The handlers go on
 * the player container; `controlsRef` and the focus handlers on the element
 * wrapping the controls.
 */
export function useControlsAutoHide({ setVisible, isSidebarOpen, hasError }: ControlsAutoHideInput) {
  // `setVisible` is taken once: the store's setter never changes.
  const [autoHide] = useState(() => new ControlsAutoHide(setVisible))
  const [controls, setControls] = useState<HTMLElement | null>(null)
  // Focus that arrives by keyboard holds the controls up; a click leaves focus
  // on the button it hit, and that must not keep them up for good.
  const keyboardInputRef = useRef(false)

  useEffect(() => {
    autoHide.start()
    return () => autoHide.dispose()
  }, [autoHide])

  useEffect(() => {
    autoHide.setHold('sidebar', isSidebarOpen)
  }, [autoHide, isSidebarOpen])

  useEffect(() => {
    autoHide.setHold('error', hasError)
  }, [autoHide, hasError])

  useEffect(() => {
    const onKeyDown = () => {
      keyboardInputRef.current = true
    }
    const onPointerDown = () => {
      keyboardInputRef.current = false
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])

  useEffect(() => {
    if (!controls) return
    const sync = () => autoHide.setHold('menu', controls.querySelector(OPEN_MENU_SELECTOR) !== null)
    sync()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(sync)
    observer.observe(controls, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] })
    return () => {
      observer.disconnect()
      autoHide.setHold('menu', false)
    }
  }, [autoHide, controls])

  const onMouseMove = useCallback((event: MouseEvent<HTMLElement>) => {
    // A hidden panel takes no pointer events, so this is only ever true while it is shown.
    const target = event.target
    autoHide.setHold('pointer', target instanceof Element && target.closest(CONTROLS_SELECTOR) !== null)
    autoHide.pointerMove(event.clientX, event.clientY)
  }, [autoHide])

  const onMouseLeave = useCallback(() => autoHide.pointerLeave(), [autoHide])

  const onControlsFocus = useCallback(() => {
    autoHide.setHold('focus', keyboardInputRef.current)
  }, [autoHide])

  const onControlsBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    autoHide.setHold('focus', false)
  }, [autoHide])

  return { onMouseMove, onMouseLeave, controlsRef: setControls, onControlsFocus, onControlsBlur }
}
