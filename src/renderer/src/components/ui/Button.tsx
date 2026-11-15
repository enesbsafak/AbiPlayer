import { forwardRef, type ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

// "Canlı renk": pills. The primary action is white with ink text (one per
// screen), the secondary a transparent pill with a white edge. Focus is the
// global sun ring (styles/globals.css).
// Every variant has the 2 px edge (most a hidden one), so they line up.
const BUTTON_BASE = 'inline-flex items-center justify-center rounded-full border-2 transition-colors disabled:pointer-events-none disabled:opacity-50'
const BUTTON_VARIANTS = {
  primary: 'border-white bg-white font-bold text-ink hover:border-surface-300 hover:bg-surface-300',
  secondary: 'border-white/50 bg-transparent font-medium text-white hover:border-white',
  ghost: 'border-transparent font-medium text-surface-400 hover:bg-surface-800 hover:text-white',
  // Destructive: coral, the language's warm warning colour, with ink on it.
  danger: 'border-coral bg-coral font-bold text-ink hover:border-[#FF8466] hover:bg-[#FF8466]'
} as const
const BUTTON_SIZES = {
  sm: 'gap-1.5 px-4 py-2 text-xs',
  md: 'gap-2 px-5 py-2.5 text-sm',
  lg: 'gap-2.5 px-7 py-3.5 text-base'
} as const

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', children, ...props }, ref) => {
    return (
      <button type="button" ref={ref} className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`} {...props}>
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'
