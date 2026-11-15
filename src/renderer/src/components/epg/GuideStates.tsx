import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { strings } from '@/strings'

const text = strings.epg

/** What the guide area says when there is no timeline to show: loading, failed, or nothing to list. */
export function GuideMessage({
  title,
  hint,
  loading = false,
  action
}: {
  title: string
  hint?: string
  loading?: boolean
  action?: ReactNode
}) {
  return (
    <div
      role={loading ? 'status' : undefined}
      className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-tile bg-raised p-8 short:p-6"
    >
      <div className="flex max-w-lg flex-col items-center gap-3 text-center">
        {loading && <Spinner size={32} className="mb-1" />}
        <h2 className="font-title text-[clamp(24px,2.4vw,30px)] leading-[1.15]">{title}</h2>
        {hint && <p className="text-base text-surface-400">{hint}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  )
}

/** The line above the timeline about the guide data: an older copy, a failed update, an incomplete guide. */
export function GuideNotice({ tone, children }: { tone: 'warning' | 'info'; children: string }) {
  if (tone === 'info') {
    return (
      <p role="status" className="-my-1 shrink-0 truncate px-1 text-sm text-surface-500" title={children}>
        {children}
      </p>
    )
  }
  return (
    <div role="alert" className="flex shrink-0 items-start gap-3 rounded-card bg-raised px-5 py-3 text-[15px] text-white">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-sun" aria-hidden="true" />
      <p className="min-w-0">{children}</p>
    </div>
  )
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="flex h-7 items-center rounded-[10px] border-b-[3px] border-deep bg-raised px-2.5 font-sans text-[13px] font-bold text-white">
      {children}
    </kbd>
  )
}

/** The keys the timeline answers to. */
export function GuideKeyHints() {
  return (
    <div
      role="group"
      aria-label={text.keysLabel}
      className="flex min-h-7 shrink-0 flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm text-surface-500 short:hidden"
    >
      <span className="flex items-center gap-2">
        <Key>{text.keyArrows}</Key>
        {text.keyArrowsAction}
      </span>
      <span className="flex items-center gap-2">
        <Key>{text.keyEnter}</Key>
        {text.keyEnterAction}
      </span>
      <span className="flex items-center gap-2">
        <Key>{text.keyFavorite}</Key>
        {text.keyFavoriteAction}
      </span>
    </div>
  )
}
