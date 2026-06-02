import { useState, useRef, useEffect, useId, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface DropdownItem {
  id: string
  label: string
  icon?: ReactNode
}

interface DropdownProps {
  items: DropdownItem[]
  value?: string
  onSelect: (id: string) => void
  placeholder?: string
  className?: string
  id?: string
  labelledBy?: string
}

export function Dropdown({ items, value, onSelect, placeholder = 'Seciniz...', className = '', id, labelledBy }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const generatedButtonId = useId()
  const menuId = useId()
  const buttonId = id ?? generatedButtonId
  const buttonLabelledBy = labelledBy ? `${labelledBy} ${buttonId}` : undefined
  const selected = items.find((i) => i.id === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-surface-50 transition-colors hover:border-surface-600"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-labelledby={buttonLabelledBy}
      >
        <span className={selected ? '' : 'text-surface-500'}>{selected?.label || placeholder}</span>
        <ChevronDown size={16} className={`ml-2 text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          id={menuId}
          className="absolute z-dropdown mt-1 max-h-60 w-full list-none overflow-y-auto rounded-lg border border-surface-800 bg-surface-900 py-1 shadow-lg"
          aria-label={placeholder}
        >
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => { onSelect(item.id); setOpen(false) }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-800 ${item.id === value ? 'text-accent' : 'text-surface-300'}`}
                aria-current={item.id === value ? 'true' : undefined}
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
