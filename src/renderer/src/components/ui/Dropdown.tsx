import { useState, useRef, useEffect, type ReactNode } from 'react'
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
}

export function Dropdown({ items, value, onSelect, placeholder = 'Seciniz...', className = '' }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
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
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-surface-50 transition-colors hover:border-surface-600"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? '' : 'text-surface-500'}>{selected?.label || placeholder}</span>
        <ChevronDown size={16} className={`ml-2 text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute z-dropdown mt-1 w-full rounded-lg border border-surface-800 bg-surface-900 py-1 shadow-lg max-h-60 overflow-y-auto"
          role="listbox"
          aria-label={placeholder}
        >
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => { onSelect(item.id); setOpen(false) }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-800 ${item.id === value ? 'text-accent' : 'text-surface-300'}`}
              role="option"
              aria-selected={item.id === value}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
