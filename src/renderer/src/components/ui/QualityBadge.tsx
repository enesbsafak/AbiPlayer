interface QualityBadgeProps {
  label: string
  className?: string
}

export function QualityBadge({ label, className = '' }: QualityBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-white/15 bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm backdrop-blur-sm ${className}`.trim()}
      title={`Kalite: ${label}`}
    >
      {label}
    </span>
  )
}
