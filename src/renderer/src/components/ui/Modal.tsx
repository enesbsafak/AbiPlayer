import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
}

export function Modal({ isOpen, onClose, title, children, className = '' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/80"
      onClick={(e) => e.target === overlayRef.current && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`relative w-full max-w-lg rounded-lg border border-surface-800 bg-surface-900 shadow-2xl ${className}`}>
        {title && (
          <div className="flex items-center justify-between border-b border-surface-800 px-6 py-4">
            <h2 className="text-base font-semibold text-surface-50">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
              aria-label="Kapat"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body
  )
}
