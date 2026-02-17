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

export function Dropdown({ items, value, onSelect, placeholder = 'Select...', className = '' }: DropdownProps) {
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
        className="flex w-full items-center justify-between rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-sm text-white hover:border-surface-500 transition-colors"
      >
        <span className={selected ? '' : 'text-surface-500'}>{selected?.label || placeholder}</span>
        <ChevronDown size={16} className={`ml-2 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-lg border border-surface-700 bg-surface-800 py-1 shadow-xl max-h-60 overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => { onSelect(item.id); setOpen(false) }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-700 transition-colors ${item.id === value ? 'text-accent' : 'text-surface-200'}`}
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
