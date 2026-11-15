import type { SVGProps } from 'react'

/*
 * The "Canlı renk" icon set, drawn as in the mock-ups (docs/tasarim): round
 * caps, thick strokes, in the current text colour. Decorative by default
 * (aria-hidden); the control around an icon carries its name.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
  /** Stroke width; the mock-ups use 2.4 for section glyphs and 2.6 to 3 for small UI glyphs. */
  weight?: number
}

function Icon({ size = 24, weight = 2.4, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

/** Canlı TV: a set with an aerial. */
export function LiveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="7" width="18" height="13" rx="3" />
      <path d="m8 3 4 4 4-4" />
      <circle cx="12" cy="13.5" r="1.6" fill="currentColor" />
    </Icon>
  )
}

/** Yayın Akışı: a calendar page with lines. */
export function GuideIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4M7 14h5M7 17.5h8" />
    </Icon>
  )
}

/** Filmler: a strip of film. */
export function FilmIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </Icon>
  )
}

/** Diziler: stacked screens with a play mark. */
export function SeriesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="9" width="18" height="12" rx="3" />
      <path d="M6 6h12M8 3h8M10.5 12.5v5l4-2.5z" />
    </Icon>
  )
}

/** Favoriler. */
export function StarIcon(props: IconProps) {
  return (
    <Icon weight={2.6} {...props}>
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
    </Icon>
  )
}

/** Ayarlar: three sliders. */
export function SlidersIcon(props: IconProps) {
  return (
    <Icon weight={2.6} {...props}>
      <path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10" />
      <circle cx="15" cy="6" r="2.4" />
      <circle cx="9" cy="12" r="2.4" />
      <circle cx="17" cy="18" r="2.4" />
    </Icon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon weight={2.6} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  )
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon weight={3} {...props}>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </Icon>
  )
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon weight={2.8} {...props}>
      <path d="M19 12H6M11 6l-6 6 6 6" />
    </Icon>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props} stroke="none" fill="currentColor">
      <path d="M7 4.5v15l12-7.5z" />
    </Icon>
  )
}

export function MinimizeIcon(props: IconProps) {
  return (
    <Icon weight={2.8} {...props}>
      <path d="M6 12h12" />
    </Icon>
  )
}

export function MaximizeIcon(props: IconProps) {
  return (
    <Icon weight={2.8} {...props}>
      <rect x="6" y="6" width="12" height="12" rx="3.5" />
    </Icon>
  )
}

/** Restore: two overlapping windows, in the same hand as MaximizeIcon. */
export function RestoreIcon(props: IconProps) {
  return (
    <Icon weight={2.6} {...props}>
      <rect x="5" y="9" width="10" height="10" rx="3" />
      <path d="M9 5.5h6.5A3 3 0 0 1 18.5 8.5V15" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon weight={2.8} {...props}>
      <path d="m7 7 10 10M17 7 7 17" />
    </Icon>
  )
}
