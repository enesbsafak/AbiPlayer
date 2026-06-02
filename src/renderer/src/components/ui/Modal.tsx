import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
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
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!isOpen || !dialog) return

    if (!dialog.open) dialog.showModal()

    return () => {
      if (dialog.open) dialog.close()
    }
  }, [isOpen])

  if (!isOpen) return null

  return createPortal(
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-modal m-0 flex h-dvh w-screen max-w-none items-center justify-center border-0 bg-black/80 p-4 text-surface-50 backdrop:bg-black/80"
      aria-label={title ? undefined : 'Pencere'}
      aria-labelledby={title ? titleId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className={`relative w-full max-w-lg rounded-lg border border-surface-800 bg-surface-900 shadow-2xl ${className}`}>
        {title && (
          <div className="flex items-center justify-between border-b border-surface-800 px-6 py-4">
            <h2 id={titleId} className="text-base font-semibold text-surface-50">{title}</h2>
            <button
              type="button"
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
    </dialog>,
    document.body
  )
}
