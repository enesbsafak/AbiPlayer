interface QualityBadgeProps {
  label: string
  className?: string
}

export function QualityBadge({ label, className = '' }: QualityBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded border border-surface-700 bg-surface-900/90 px-1.5 py-0.5 text-caption font-semibold uppercase tracking-wider text-surface-300 ${className}`.trim()}
      title={`Kalite: ${label}`}
    >
      {label}
    </span>
  )
}
