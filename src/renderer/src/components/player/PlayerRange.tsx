import type { InputHTMLAttributes } from 'react'

interface PlayerRangeProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'style' | 'value' | 'min' | 'max'> {
  value: number
  min: number
  max: number
  /** Height of the bar in px: 12 for the seek bar, 8 for volume and settings. */
  thickness?: number
  /** Classes of the outer box (its width, its flex share). */
  className?: string
  /** The fill: sun (progress, volume) or a section colour class. */
  fillClassName?: string
}

/**
 * A thick, fully rounded bar with a flat fill, drawn behind a native range
 * input that keeps the slider role, the keyboard, the pointer handling and
 * the focus ring. The input spans the whole bar, so a click lands where it
 * looks like it does.
 */
export function PlayerRange({
  value,
  min,
  max,
  thickness = 8,
  className = '',
  fillClassName = 'bg-sun',
  ...inputProps
}: PlayerRangeProps) {
  const span = max - min
  const share = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0

  return (
    <div className={`relative flex h-7 min-w-0 items-center ${className}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-white/20"
        style={{ height: thickness }}
      >
        <div className={`h-full rounded-full ${fillClassName}`} style={{ width: `${share * 100}%` }} />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        {...inputProps}
        className="relative h-full w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
      />
    </div>
  )
}
