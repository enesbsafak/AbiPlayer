/**
 * When the player's controls (and the mouse cursor with them) are shown.
 *
 * They show when the player opens and on any sign of use, and hide once
 * nothing has happened for `CONTROLS_HIDE_DELAY_MS`. A hold keeps them up for
 * as long as it lasts (the pointer resting on them, a menu open, keyboard
 * focus inside them, the channel list open); the delay starts over when the
 * last hold ends.
 */

export const CONTROLS_HIDE_DELAY_MS = 3000

/**
 * How far the pointer has to travel before it counts as use. A mouse on an
 * uneven surface reports moves of a pixel or two, and Chromium sends a
 * zero-length `mousemove` when the page changes under a resting pointer.
 */
export const POINTER_MOVE_THRESHOLD_PX = 6

export type ControlsHold = 'pointer' | 'menu' | 'focus' | 'sidebar' | 'error'

export interface ControlsAutoHideOptions {
  delayMs?: number
  thresholdPx?: number
}

export class ControlsAutoHide {
  private readonly delayMs: number
  private readonly thresholdPx: number
  private readonly holds = new Set<ControlsHold>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private anchor: { x: number; y: number } | null = null
  private shown = true
  /** Not started yet, or disposed: holds are recorded, nothing is shown, hidden or timed. */
  private idle = true

  constructor(
    private readonly onChange: (visible: boolean) => void,
    options: ControlsAutoHideOptions = {}
  ) {
    this.delayMs = options.delayMs ?? CONTROLS_HIDE_DELAY_MS
    this.thresholdPx = options.thresholdPx ?? POINTER_MOVE_THRESHOLD_PX
  }

  get visible(): boolean {
    return this.shown
  }

  /** The player opened: show, and start counting down right away. */
  start(): void {
    this.idle = false
    // Reported even if nothing changed here: whoever listens may still say hidden from last time.
    this.shown = true
    this.onChange(true)
    this.arm()
  }

  dispose(): void {
    this.idle = true
    this.clearTimer()
  }

  /** Something was done (a key, a real pointer move): show and count down again. */
  activity(): void {
    if (this.idle) return
    this.setShown(true)
    this.arm()
  }

  /** A pointer position over the player. Only a move of `thresholdPx` or more counts as use. */
  pointerMove(x: number, y: number): void {
    const anchor = this.anchor
    if (!anchor) {
      // The first position seen is only where the pointer is, not a move.
      this.anchor = { x, y }
      return
    }
    if (Math.hypot(x - anchor.x, y - anchor.y) < this.thresholdPx) return
    this.anchor = { x, y }
    this.activity()
  }

  /** The pointer left the player: hide now, unless something holds the controls. */
  pointerLeave(): void {
    this.holds.delete('pointer')
    if (this.idle || this.holds.size > 0) return
    this.clearTimer()
    this.setShown(false)
  }

  setHold(hold: ControlsHold, on: boolean): void {
    if (on) {
      if (this.holds.has(hold)) return
      this.holds.add(hold)
      if (this.idle) return
      this.clearTimer()
      this.setShown(true)
      return
    }
    if (!this.holds.delete(hold)) return
    // The last hold ended: the delay starts from now.
    if (this.holds.size === 0) this.arm()
  }

  private arm(): void {
    this.clearTimer()
    if (this.idle || this.holds.size > 0) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.holds.size === 0) this.setShown(false)
    }, this.delayMs)
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private setShown(shown: boolean): void {
    if (this.shown === shown) return
    this.shown = shown
    this.onChange(shown)
  }
}
