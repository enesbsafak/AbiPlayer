import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { strings } from '@/strings'
import { WindowControls } from './WindowControls'

interface ErrorScreenProps {
  title: string
  /** What happened, in one plain sentence. */
  message: string
  /** What to do about it, in one sentence. */
  hint: string
  /** Raw error text, folded away; useful when reporting the bug. */
  detail?: string
  /**
   * The shell (and its title bar) is gone, so draw a drag strip with the
   * window controls — otherwise the frameless window can no longer be closed.
   */
  fullScreen?: boolean
  /** One primary action first; a second, quieter one at most. */
  actions: ReactNode
}

/*
 * A calm card on the ground, not an alarm: coral only as the small disc
 * beside the title. What happened, what to do, one white action.
 */
export function ErrorScreen({ title, message, hint, detail, fullScreen = false, actions }: ErrorScreenProps) {
  const card = (
    <div className="flex w-full max-w-[540px] flex-col gap-5 rounded-tile bg-raised p-8 short:gap-4 short:p-7">
      <div className="flex items-center gap-4">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-coral text-ink">
          <AlertCircle size={26} strokeWidth={2.4} />
        </span>
        <h2 className="font-title text-[30px] leading-[1.1]">{title}</h2>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[17px] text-surface-300">{message}</p>
        <p className="text-[17px] font-medium text-white">{hint}</p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-3">{actions}</div>
      {detail && detail !== message && (
        <details className="text-sm text-surface-500">
          <summary className="cursor-pointer select-none rounded-full font-medium hover:text-surface-300">
            {strings.common.technicalDetail}
          </summary>
          <p className="mt-2 select-text break-words rounded-2xl bg-deep p-4 font-mono text-[13px] text-surface-400">{detail}</p>
        </details>
      )}
    </div>
  )

  if (!fullScreen) {
    return (
      <div role="alert" className="flex h-full min-h-[50vh] items-center justify-center p-4 text-white">
        {card}
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-ground text-white">
      <div className="drag-region flex min-h-[64px] shrink-0 items-center justify-end px-6 pt-5">
        <WindowControls />
      </div>
      <div role="alert" className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
        {card}
      </div>
    </div>
  )
}

/** The screen's one primary action: a white pill, ink text. */
export const ERROR_ACTION_CLASS =
  'flex h-14 items-center gap-2.5 rounded-full bg-white px-7 text-[17px] font-bold text-ink transition-colors hover:bg-surface-300 short:h-12'
/** A quieter way out: transparent, a 2 px edge of white at 50 %. */
export const ERROR_SECONDARY_ACTION_CLASS =
  'flex h-14 items-center gap-2.5 rounded-full border-2 border-white/50 px-6 text-base font-medium text-white transition-colors hover:border-white short:h-12'
