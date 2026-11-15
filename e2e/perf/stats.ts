export function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function range(values: number[]): string {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return '–'
  return `${fmt(Math.min(...finite))}–${fmt(Math.max(...finite))}`
}

export function fmt(value: number | null | undefined, unit = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–'
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded.toLocaleString('tr-TR')}${unit}`
}
