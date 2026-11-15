import { forwardRef, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-surface-200">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={`h-12 w-full rounded-full border-2 bg-ground px-5 text-base text-white placeholder:text-surface-500 transition-colors focus:border-sun focus:outline-none focus-visible:outline-none ${error ? 'border-coral' : 'border-surface-700 hover:border-surface-600'} ${className}`}
          {...props}
        />
        {error && <p className="px-2 text-sm text-coral">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'
