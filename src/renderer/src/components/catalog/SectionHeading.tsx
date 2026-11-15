import type { ReactNode } from 'react'
import { TONE, type Tone } from '@/components/layout/sections'

interface SectionHeadingProps {
  id?: string
  /** The colour of the section the heading belongs to: its mark. */
  tone: Tone
  children: ReactNode
  /** A real count after the heading, quieter. */
  count?: string
  /** The line's right end, e.g. a "Tümünü gör" pill. */
  trailing?: ReactNode
  as?: 'h2' | 'h3'
}

/**
 * A heading above its content, on one line, as on the home screen: a small
 * square in the section colour, the title in the display face at 23 px, an
 * optional count, and room at the right end. Long titles truncate.
 */
export function SectionHeading({ id, tone, children, count, trailing, as: Tag = 'h2' }: SectionHeadingProps) {
  return (
    <div className="flex h-7 min-w-0 shrink-0 items-center gap-3">
      <span aria-hidden="true" className={`size-3 shrink-0 rounded-[4px] ${TONE[tone].fill}`} />
      <Tag id={id} className="font-title min-w-0 truncate text-[23px] leading-[1.2]">
        {children}
      </Tag>
      {count && <span className="shrink-0 text-[15px] font-bold tabular-nums text-surface-500">{count}</span>}
      {trailing && <div className="ml-auto shrink-0">{trailing}</div>}
    </div>
  )
}
