// Element -> nearest scrolling element at or above it (null: the viewport).
// Grid cards share their ancestors, so after the first lookup in a list the
// walk stops at the first cached ancestor instead of calling getComputedStyle
// on every element up to <body> for each card.
const scrollRootCache = new WeakMap<Element, HTMLElement | null>()

function isScrollContainer(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  const overflowY = style.overflowY || style.overflow
  return /\b(auto|scroll)\b/.test(overflowY)
}

/**
 * The nearest scrolling ancestor of `element` (not the element itself), for
 * use as an IntersectionObserver root, or null when the page itself scrolls.
 * Results are memoized per ancestor; an element whose overflow style changes
 * after the first lookup keeps its old answer.
 */
export function findScrollRoot(element: Element | null): HTMLElement | null {
  const visited: Element[] = []
  let current: Element | null = element?.parentElement ?? null
  let result: HTMLElement | null = null

  while (current) {
    const cached = scrollRootCache.get(current)
    if (cached !== undefined) {
      result = cached
      break
    }
    visited.push(current)
    if (current instanceof HTMLElement && isScrollContainer(current)) {
      result = current
      break
    }
    current = current.parentElement
  }

  for (const node of visited) scrollRootCache.set(node, result)
  return result
}
