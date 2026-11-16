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
    overflow: 'hidden',
    // Names written without spaces ("Some.Film.Name.2018") wrap onto the next
    // line instead of running out of the box as one long word.
    overflowWrap: 'anywhere'
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
  return createElement(
    as,
    {
      ...props,
      title: titleText ?? title,
      style: {
        ...getClampStyle(lines),
        ...style
      }
    },
    children
  )
}
