import { forwardRef, type ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', children, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center rounded-xl font-semibold tracking-wide transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:pointer-events-none disabled:opacity-50'
    const variants = {
      primary: 'border border-[#90bcff]/85 bg-[linear-gradient(170deg,#7eb1ff,#5e92f1)] text-white shadow-[0_10px_24px_rgba(79,132,236,0.38)] hover:brightness-110',
      secondary: 'border border-white/24 bg-white/12 text-surface-100 backdrop-blur-md hover:bg-white/20',
      ghost: 'border border-transparent text-surface-200 hover:border-white/20 hover:bg-white/12 hover:text-white',
      danger: 'border border-red-500/80 bg-red-600 text-white hover:bg-red-700'
    }
    const sizes = {
      sm: 'gap-1.5 px-3 py-1.5 text-xs',
      md: 'gap-2 px-4 py-2 text-sm',
      lg: 'gap-2.5 px-6 py-3 text-base'
    }

    return (
      <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'
