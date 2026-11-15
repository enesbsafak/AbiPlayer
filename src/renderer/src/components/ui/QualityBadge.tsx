import { strings } from '@/strings'

interface QualityBadgeProps {
  label: string
  className?: string
}

export function QualityBadge({ label, className = '' }: QualityBadgeProps) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full bg-ground/85 px-2.5 text-xs font-bold uppercase tracking-wide text-white ${className}`.trim()}
      title={strings.common.qualityTitle(label)}
    >
      {label}
    </span>
  )
}
