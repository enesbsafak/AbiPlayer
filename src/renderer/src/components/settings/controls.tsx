import { forwardRef, useId, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

/*
 * The pieces settings and the add-source step are built from ("Canlı renk",
 * docs/tasarim): a group is a one-line heading with a sky square above a calm
 * raised card; every setting is a row with its label and one line of help on
 * the left and its control on the right. Built here rather than in
 * components/ui because nothing else uses them yet.
 *
 * Class strings are written out in full so Tailwind finds them.
 */

/** Pills. One white primary per screen; secondary is a transparent pill with a 2 px white edge. */
export const ACTION = {
  primary:
    'inline-flex h-14 shrink-0 items-center justify-center gap-2.5 rounded-full bg-white px-7 text-[17px] font-bold text-ink transition-colors hover:bg-surface-300 disabled:pointer-events-none disabled:opacity-60 short:h-12',
  secondary:
    'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border-2 border-white/50 px-5 text-[15px] font-medium text-white transition-colors hover:border-white disabled:pointer-events-none disabled:opacity-50',
  /** Removes or resets something; always asks first. */
  danger:
    'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-coral px-5 text-[15px] font-bold text-ink transition-colors hover:bg-coral/85 disabled:pointer-events-none disabled:opacity-50',
  /** A round icon-only button; give it an aria-label. */
  icon: 'flex size-11 shrink-0 items-center justify-center rounded-full bg-ground text-white transition-colors hover:bg-surface-800 disabled:pointer-events-none disabled:opacity-50',
  /** The icon button that removes something: a coral glyph, filled coral on hover. */
  iconDanger:
    'flex size-11 shrink-0 items-center justify-center rounded-full bg-ground text-coral transition-colors hover:bg-coral hover:text-ink disabled:pointer-events-none disabled:opacity-50',
  /** A quiet text link with an icon. */
  link: 'inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-surface-400 transition-colors hover:text-white'
} as const

/** A text field: a pill-shaped well on the raised card. */
export const INPUT_CLASS =
  'h-[52px] w-full min-w-0 rounded-full bg-ground px-5 text-base text-white transition-colors placeholder:text-surface-600 hover:bg-deep focus:bg-deep disabled:opacity-60'

type Tone = 'sky' | 'coral' | 'mint' | 'sun'

const TONE_FILL: Record<Tone, string> = {
  sky: 'bg-sky',
  coral: 'bg-coral',
  mint: 'bg-mint',
  sun: 'bg-sun'
}

interface SettingsGroupProps {
  title: string
  /** Settings wear sky; the destructive group wears coral. */
  tone?: Tone
  /** A short real count or state on the heading's line ("2 kaynak"). */
  aside?: ReactNode
  children: ReactNode
  className?: string
}

/** A one-line heading with a square in the section colour, and what belongs under it. */
export function SettingsGroup({ title, tone = 'sky', aside, children, className = '' }: SettingsGroupProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <div className="flex min-h-7 min-w-0 items-center gap-3">
        <span aria-hidden="true" className={`size-3 shrink-0 rounded-[4px] ${TONE_FILL[tone]}`} />
        <h3 id={headingId} className="font-title min-w-0 truncate text-[23px] leading-[1.2]">
          {title}
        </h3>
        {aside != null && <span className="ml-auto shrink-0 text-sm font-medium text-surface-400">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

/** The calm card a group's rows sit in; rows are parted by a line of the ground. */
export function SettingsCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex min-w-0 flex-col divide-y-2 divide-ground rounded-card bg-raised ${className}`}>{children}</div>
}

interface SettingRowProps {
  label: ReactNode
  /** One line of plain-language help under the label. */
  help?: ReactNode
  /** The control the label names; the label becomes its <label>. */
  htmlFor?: string
  labelId?: string
  helpId?: string
  /** The control, at the right (below the label in a narrow window). */
  control?: ReactNode
  /** Anything under the row: a status line, a preview, a list. */
  children?: ReactNode
}

export function SettingRow({ label, help, htmlFor, labelId, helpId, control, children }: SettingRowProps) {
  const labelClass = 'block text-base font-bold leading-snug text-white'
  return (
    <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-[min(100%,240px)] flex-1">
          {htmlFor ? (
            <label htmlFor={htmlFor} id={labelId} className={`${labelClass} cursor-pointer`}>
              {label}
            </label>
          ) : (
            <p id={labelId} className={labelClass}>
              {label}
            </p>
          )}
          {help && (
            <p id={helpId} className="mt-1 text-sm text-surface-400">
              {help}
            </p>
          )}
        </div>
        {control && <div className="flex min-w-0 max-w-full shrink-0 items-center">{control}</div>}
      </div>
      {children}
    </div>
  )
}

interface SwitchProps {
  /** Needed when a <label htmlFor> outside names it; not when a <label> wraps it. */
  id?: string
  checked: boolean
  onChange: (checked: boolean) => void
  describedBy?: string
  label?: string
  disabled?: boolean
}

/**
 * An on/off switch: mint with an ink knob when on. A real checkbox underneath
 * (sized over the drawing, transparent), so the row's <label>, Space and the
 * checkbox role all work as before.
 */
export function Switch({ id, checked, onChange, describedBy, label, disabled }: SwitchProps) {
  return (
    <span className="relative inline-flex h-8 w-14 shrink-0">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={describedBy}
        aria-label={label}
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-default"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full bg-surface-700 transition-colors peer-checked:bg-mint peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-sun peer-disabled:opacity-50"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1 top-1 size-6 rounded-full bg-white transition-transform peer-checked:translate-x-6 peer-checked:bg-ink"
      />
    </span>
  )
}

export interface ChoiceOption<T extends string> {
  id: T
  label: string
  /** Fill when chosen; sky (settings) unless the choice is a section. */
  tone?: Tone
}

interface PillChoiceProps<T extends string> {
  options: ReadonlyArray<ChoiceOption<T>>
  value: T
  onChange: (value: T) => void
  labelledBy?: string
  label?: string
  describedBy?: string
  className?: string
}

/**
 * One of a few choices, as a group of pills: the chosen one is filled, ink on
 * colour. A radio group: Tab reaches the chosen pill, the arrow keys move the
 * choice.
 */
export function PillChoice<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
  label,
  describedBy,
  className = ''
}: PillChoiceProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value)
  )

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = selectedIndex >= last ? 0 : selectedIndex + 1
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = selectedIndex <= 0 ? last : selectedIndex - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    const option = next === null ? undefined : options[next]
    if (next === null || !option) return
    event.preventDefault()
    // The page's own shortcuts must not see the arrow as well.
    event.stopPropagation()
    onChange(option.id)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={label}
      aria-describedby={describedBy}
      onKeyDown={move}
      className={`inline-flex max-w-full flex-wrap gap-1 rounded-[26px] bg-ground p-1 ${className}`}
    >
      {options.map((option, index) => {
        const selected = index === selectedIndex
        return (
          <button
            key={option.id}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.id)}
            className={`h-11 whitespace-nowrap rounded-full px-[18px] text-[15px] transition-colors ${
              selected ? `${TONE_FILL[option.tone ?? 'sky']} font-bold text-ink` : 'font-medium text-white hover:bg-surface-800'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string
  label: string
  /** One line under the field: what it is and where to find it. */
  help?: string
  /** Shown beside the field, in coral, and announced. */
  error?: string | null
  className?: string
}

/** A labelled text field with its help line and, when there is one, its error. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, help, error, className = '', ...props },
  ref
) {
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`}>
      <label htmlFor={id} className="text-[15px] font-bold text-white">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${INPUT_CLASS} ${error ? 'ring-2 ring-inset ring-coral' : ''}`}
        {...props}
      />
      {error && <FieldError id={errorId}>{error}</FieldError>}
      {help && (
        <p id={helpId} className="px-1 text-sm text-surface-400">
          {help}
        </p>
      )}
    </div>
  )
})

/** An error beside what it concerns: a coral dot and the sentence, announced when it appears. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-2 px-1 text-sm font-medium text-coral">
      <span aria-hidden="true" className="mt-[5px] size-2 shrink-0 rounded-full bg-coral" />
      <span>{children}</span>
    </p>
  )
}
