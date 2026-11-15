import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { strings } from '@/strings'
import { Button } from './Button'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Coral confirm button for actions that remove or reset something. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A yes/no question on top of Modal, for actions that are hard to undo. */
export function ConfirmDialog({
  isOpen,
  title,
  children,
  confirmLabel,
  cancelLabel = strings.common.cancel,
  destructive = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title}>
      <div className="text-base leading-relaxed text-surface-300">{children}</div>
      <div className="mt-7 flex flex-wrap justify-end gap-3">
        {/* Focus lands on the safe choice, so a stray Enter does not confirm. */}
        <Button variant="secondary" onClick={onCancel} data-autofocus>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
