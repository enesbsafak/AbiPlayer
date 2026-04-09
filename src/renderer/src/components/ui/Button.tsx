import { forwardRef, type ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', children, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950 disabled:pointer-events-none disabled:opacity-50'
    const variants = {
      primary: 'bg-accent text-white hover:bg-accent-600',
      secondary: 'border border-surface-700 bg-surface-900 text-surface-200 hover:bg-surface-800 hover:text-surface-50',
      ghost: 'text-surface-400 hover:bg-surface-800 hover:text-surface-50',
      danger: 'bg-red-600 text-white hover:bg-red-700'
    }
    const sizes = {
      sm: 'gap-1.5 px-3 py-1.5 text-xs',
      md: 'gap-2 px-4 py-2 text-sm',
      lg: 'gap-2.5 px-5 py-2.5 text-sm'
    }

    return (
      <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'
