import { useLayoutEffect, useState } from 'react'
import { clearanceAbove } from '@/components/player/subtitle-clearance'

export interface DockClearance {
  /** The dock's top edge above the player's bottom edge (CSS px). */
  inPlayer: number
  /** The dock's top edge above the window's bottom edge (CSS px). */
  inWindow: number
  /** The window height it was measured in: the same clearance is a different share of another height. */
  windowHeight: number
}

const NONE: DockClearance = { inPlayer: 0, inWindow: 0, windowHeight: 0 }

/**
 * Where the dock's top edge is, followed as the dock (its size, the key
 * hints) and the player (the window) change. Measured whether the dock is
 * shown or not: it keeps its layout while hidden.
 */
export function useDockClearance(player: HTMLElement | null, dock: HTMLElement | null): DockClearance {
  const [clearance, setClearance] = useState<DockClearance>(NONE)

  useLayoutEffect(() => {
    if (!player || !dock) {
      setClearance(NONE)
      return
    }

    const measure = () => {
      const dockTop = dock.getBoundingClientRect().top
      const next: DockClearance = {
        inPlayer: clearanceAbove(player.getBoundingClientRect().bottom, dockTop),
        inWindow: clearanceAbove(window.innerHeight, dockTop),
        windowHeight: window.innerHeight
      }
      setClearance((previous) =>
        previous.inPlayer === next.inPlayer &&
        previous.inWindow === next.inWindow &&
        previous.windowHeight === next.windowHeight
          ? previous
          : next
      )
    }

    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }

    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(dock)
    observer?.observe(player)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [player, dock])

  return clearance
}
