import {
  useState,
  useRef,
  useEffect,
  useId,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { ChevronDown } from 'lucide-react'
import { strings } from '@/strings'

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

/**
 * Menu-button pattern: the trigger opens a `menu` of `menuitemradio` entries.
 * Arrow keys, Home and End move between entries, Enter or Space picks one,
 * Escape closes, and focus goes back to the trigger whenever the menu closes
 * from the keyboard or a pick.
 */
export function Dropdown({ items, value, onSelect, placeholder = strings.common.selectPlaceholder, className = '', id, labelledBy }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const generatedButtonId = useId()
  const menuId = useId()
  const buttonId = id ?? generatedButtonId
  const buttonLabelledBy = labelledBy ? `${labelledBy} ${buttonId}` : undefined
  const selectedIndex = items.findIndex((i) => i.id === value)
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.focus()
  }, [open, activeIndex])

  const openMenu = (index: number) => {
    if (items.length === 0) return
    setActiveIndex(Math.max(0, Math.min(items.length - 1, index)))
    setOpen(true)
  }

  const closeMenu = (returnFocus: boolean) => {
    setOpen(false)
    setActiveIndex(-1)
    if (returnFocus) triggerRef.current?.focus()
  }

  const pick = (itemId: string) => {
    onSelect(itemId)
    closeMenu(true)
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        event.preventDefault()
        openMenu(selectedIndex >= 0 ? selectedIndex : 0)
        break
      case 'ArrowUp':
        event.preventDefault()
        openMenu(selectedIndex >= 0 ? selectedIndex : items.length - 1)
        break
    }
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = items.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((index) => (index >= last ? 0 : index + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((index) => (index <= 0 ? last : index - 1))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(last)
        break
      case 'Escape':
        event.preventDefault()
        // Settings pages sit inside other Escape handlers; this one is ours.
        event.stopPropagation()
        closeMenu(true)
        break
      case 'Tab':
        closeMenu(false)
        break
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        id={buttonId}
        type="button"
        onClick={() => (open ? closeMenu(false) : openMenu(selectedIndex >= 0 ? selectedIndex : 0))}
        onKeyDown={handleTriggerKeyDown}
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
          role="menu"
          aria-labelledby={buttonId}
          onKeyDown={handleMenuKeyDown}
          className="absolute z-dropdown mt-1 max-h-60 w-full list-none overflow-y-auto rounded-lg border border-surface-800 bg-surface-900 py-1 shadow-lg"
        >
          {items.map((item, index) => (
            <li key={item.id} role="none">
              <button
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                type="button"
                role="menuitemradio"
                aria-checked={item.id === value}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => pick(item.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-800 focus:bg-surface-800 focus:outline-none ${item.id === value ? 'text-accent' : 'text-surface-300'}`}
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
