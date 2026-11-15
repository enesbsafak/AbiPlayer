import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { CONTROL_SIZE, filledClasses, roundButton, useDockLayout } from './player-ui'

interface DockPillProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'value'> {
  icon: ReactNode
  /** The small line: what the control is. */
  label: string
  /** The bold line: what it is set to now. */
  value: string
  /** Open, or set away from its default: filled with the section colour. */
  active?: boolean
}

/**
 * A dock control that opens a panel. With room it is a pill that says what it
 * is and what it is set to ("Altyazı / Kapalı"); in a narrow dock it condenses
 * to a round icon button. Either way the accessible name comes from the
 * caller's aria-label, so it does not change with the window size.
 */
export function DockPill({ icon, label, value, active = false, ...buttonProps }: DockPillProps) {
  const { size, tone } = useDockLayout()

  if (size === 's' || size === 'xs') {
    return (
      <button type="button" {...buttonProps} className={roundButton(size, active ? tone : undefined)}>
        {icon}
      </button>
    )
  }

  return (
    <button
      type="button"
      {...buttonProps}
      className={`flex ${CONTROL_SIZE[size].height} min-w-0 shrink-0 flex-col justify-center rounded-full px-[18px] text-left transition-colors ${
        size === 'l' ? 'max-w-[184px]' : 'max-w-[144px]'
      } ${active ? filledClasses(tone) : 'bg-raised text-white hover:bg-surface-800'}`}
    >
      <span className={`truncate text-[13px] font-medium leading-[1.2] ${active ? 'text-ink' : 'text-surface-500'}`}>{label}</span>
      <span className="truncate text-[15px] font-bold leading-[1.25]">{value}</span>
    </button>
  )
}
