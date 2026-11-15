/**
 * Keyboard model of a card grid (and, with one column, of a list): which
 * index an arrow, Home/End or Page key moves the focus to. Pure, so the
 * virtualized grids and the category list share one tested rule.
 */

export interface GridGeometry {
  /** Number of items. */
  count: number
  /** Items per row (1 for a list). */
  columns: number
  /** Rows one PageUp / PageDown moves. */
  pageRows: number
}

export interface GridKey {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The index the key moves to from `current`, or null when the key is not a
 * navigation key (or the grid is empty). Left and Right wrap across rows the
 * way reading order does; Up and Down keep the column, and Down on the last
 * row lands on the last item rather than doing nothing. Home and End go to
 * the start and end of the row, with Ctrl to the first and last item.
 */
export function nextGridIndex(current: number, event: GridKey, geometry: GridGeometry): number | null {
  const { count } = geometry
  if (count <= 0) return null
  if (event.altKey || event.shiftKey) return null
  const columns = Math.max(1, Math.floor(geometry.columns))
  const pageRows = Math.max(1, Math.floor(geometry.pageRows))
  const from = clamp(current, 0, count - 1)
  const rowStart = from - (from % columns)
  const withModifier = event.ctrlKey || event.metaKey

  switch (event.key) {
    case 'ArrowRight':
      return withModifier ? null : clamp(from + 1, 0, count - 1)
    case 'ArrowLeft':
      return withModifier ? null : clamp(from - 1, 0, count - 1)
    case 'ArrowDown':
      return withModifier ? null : from + columns < count ? from + columns : rowStart + columns < count ? count - 1 : from
    case 'ArrowUp':
      return withModifier ? null : from - columns >= 0 ? from - columns : from
    case 'PageDown':
      return withModifier ? null : clamp(from + columns * pageRows, 0, count - 1)
    case 'PageUp':
      return withModifier ? null : clamp(from - columns * pageRows, 0, count - 1)
    case 'Home':
      return withModifier ? 0 : rowStart
    case 'End':
      return withModifier ? count - 1 : Math.min(rowStart + columns - 1, count - 1)
    default:
      return null
  }
}

export interface GridColumnLayout {
  minCardWidth: number
  maxColumns: number
  gap: number
}

/** Columns that fit `width`, at least two and at most `maxColumns`. */
export function gridColumns(width: number, layout: GridColumnLayout): number {
  const raw = Math.floor((width + layout.gap) / (layout.minCardWidth + layout.gap))
  return Math.max(2, Math.min(layout.maxColumns, raw || 1))
}
