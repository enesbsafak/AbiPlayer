import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { strings } from '@/strings'

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
    // React's autoFocus fires before the dialog is open and is lost, so a child
    // marks the element that should take focus instead of the close button.
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()

    return () => {
      if (dialog.open) dialog.close()
    }
  }, [isOpen])

  if (!isOpen) return null

  return createPortal(
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-modal m-0 flex h-dvh w-screen max-w-none items-center justify-center border-0 bg-black/80 p-4 text-surface-50 backdrop:bg-black/80"
      aria-label={title ? undefined : strings.common.dialog}
      aria-labelledby={title ? titleId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className={`relative w-full max-w-lg rounded-tile border-2 border-surface-700 bg-raised ${className}`}>
        {title && (
          <div className="flex items-center justify-between gap-4 px-7 pt-6">
            <h2 id={titleId} className="font-title text-[26px] leading-[1.1] text-white">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ground text-white transition-colors hover:bg-surface-800"
              aria-label={strings.common.close}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="px-7 pb-7 pt-5">{children}</div>
      </div>
    </dialog>,
    document.body
  )
}
