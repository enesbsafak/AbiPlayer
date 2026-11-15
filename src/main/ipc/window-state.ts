export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedWindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

export const DEFAULT_WINDOW_STATE: SavedWindowState = { width: 1280, height: 800, isMaximized: false }
const MIN_WIDTH = 900
const MIN_HEIGHT = 600
const MAX_DIMENSION = 100_000

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Validates window-state.json field by field; anything malformed falls back to the default. */
export function parseWindowState(raw: unknown): SavedWindowState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WINDOW_STATE }
  const data = raw as Record<string, unknown>

  const width = isFiniteNumber(data.width) && data.width > 0 && data.width < MAX_DIMENSION ? data.width : null
  const height = isFiniteNumber(data.height) && data.height > 0 && data.height < MAX_DIMENSION ? data.height : null
  const state: SavedWindowState = {
    width: Math.max(MIN_WIDTH, Math.round(width ?? DEFAULT_WINDOW_STATE.width)),
    height: Math.max(MIN_HEIGHT, Math.round(height ?? DEFAULT_WINDOW_STATE.height)),
    isMaximized: data.isMaximized === true
  }

  if (isFiniteNumber(data.x) && isFiniteNumber(data.y)) {
    state.x = Math.round(data.x)
    state.y = Math.round(data.y)
  }
  return state
}

/** True when at least the title bar area of the saved position lands on one of the work areas. */
export function isStateOnScreen(state: SavedWindowState, workAreas: Rect[]): boolean {
  if (state.x === undefined || state.y === undefined) return true
  const { x: left, y: top } = state
  return workAreas.some(
    ({ x, y, width, height }) =>
      left + state.width > x + 50 && left < x + width - 50 && top >= y - 10 && top < y + height - 50
  )
}

export interface TrackedWindow {
  isMaximized(): boolean
  isMinimized(): boolean
  isFullScreen(): boolean
  getBounds(): Rect
  getNormalBounds(): Rect
}

/**
 * Remembers what the window should come back as.
 *
 * Bounds always come from `getNormalBounds()`, which Electron keeps as the
 * restored size whatever state the window is in — saving `getBounds()` while
 * fullscreen or minimized stored the screen size, or a minimized placeholder,
 * as the "normal" size.
 *
 * Whether it was maximized cannot be read back in every state: in fullscreen
 * and when minimized `isMaximized()` reports false. So the flag is tracked
 * from maximize/unmaximize events, ignoring the ones fired while fullscreen
 * or minimized.
 */
export class WindowStateTracker {
  private maximized: boolean

  constructor(private readonly window: TrackedWindow, initiallyMaximized = false) {
    this.maximized = initiallyMaximized || window.isMaximized()
  }

  onMaximizeChanged(): void {
    if (this.window.isFullScreen() || this.window.isMinimized()) return
    this.maximized = this.window.isMaximized()
  }

  capture(): SavedWindowState {
    // The tracked flag, not isMaximized(): besides fullscreen and minimized,
    // a window closed before its first paint has not been maximized yet.
    const isMaximized = this.maximized
    const bounds = this.window.getNormalBounds()
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized
    }
  }
}
