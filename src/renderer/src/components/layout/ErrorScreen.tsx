import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { strings } from '@/strings'
import { WindowControls } from './TitleBar'

interface ErrorScreenProps {
  title: string
  message: string
  /** Raw error text, folded away; useful when reporting the bug. */
  detail?: string
  /**
   * The shell (and its title bar) is gone, so draw a drag strip with the
   * window controls — otherwise the frameless window can no longer be closed.
   */
  fullScreen?: boolean
  actions: ReactNode
}

export function ErrorScreen({ title, message, detail, fullScreen = false, actions }: ErrorScreenProps) {
  const card = (
    <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-red-500/25 bg-red-500/10 p-8 text-center">
      <AlertCircle size={48} className="text-red-400" aria-hidden="true" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-surface-400">{message}</p>
      {detail && detail !== message && (
        <details className="w-full text-left text-xs text-surface-500">
          <summary className="cursor-pointer select-none">{strings.common.technicalDetail}</summary>
          <p className="mt-2 break-words font-mono">{detail}</p>
        </details>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>
    </div>
  )

  if (!fullScreen) {
    return (
      <div role="alert" className="flex h-full min-h-[50vh] items-center justify-center p-4 text-surface-50">
        {card}
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-surface-950 text-surface-50">
      <div className="drag-region flex h-11 shrink-0 items-center justify-end border-b border-surface-800 px-4">
        <WindowControls />
      </div>
      <div role="alert" className="flex flex-1 items-center justify-center p-4">
        {card}
      </div>
    </div>
  )
}

export const ERROR_ACTION_CLASS =
  'flex items-center gap-2 rounded-lg bg-accent/20 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/30'
export const ERROR_SECONDARY_ACTION_CLASS =
  'flex items-center gap-2 rounded-lg border border-surface-700 px-4 py-2 text-sm font-medium text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-50'
