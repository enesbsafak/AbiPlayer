import { createElement, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

interface ClampTextProps extends HTMLAttributes<HTMLElement> {
  as?: 'span' | 'p' | 'div'
  lines?: number
  children: ReactNode
  titleText?: string
}

function getClampStyle(lines: number): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden'
  }
}

export function ClampText({
  as = 'span',
  children,
  lines = 2,
  style,
  title,
  titleText,
  ...props
}: ClampTextProps) {
  const resolvedTitle =
    titleText ?? title ?? (typeof children === 'string' ? children : undefined)

  return createElement(
    as,
    {
      ...props,
      title: resolvedTitle,
      style: {
        ...getClampStyle(lines),
        ...style
      }
    },
    children
  )
}
