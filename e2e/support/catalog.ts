// Helpers for the catalog pages (Live TV, Films, Series): the card grid, its
// scroll container and the keyboard focus.

import type { Page } from '@playwright/test'

/** The card grid of a catalog page, by its accessible name ("Kanallar", "Filmler", "Diziler"). */
export function grid(page: Page, name: string) {
  return page.getByRole('group', { name, exact: true })
}

/** scrollTop of the element that scrolls the grid. */
export async function gridScrollTop(page: Page, name: string): Promise<number> {
  return grid(page, name).evaluate((element) => {
    let current = element.parentElement
    while (current && !/(auto|scroll)/.test(getComputedStyle(current).overflowY)) current = current.parentElement
    return current ? current.scrollTop : -1
  })
}

/** Scrolls the grid's scroll container to `top` and waits two frames for the virtualizer. */
export async function scrollGridTo(page: Page, name: string, top: number): Promise<number> {
  return grid(page, name).evaluate(async (element, top) => {
    let current = element.parentElement
    while (current && !/(auto|scroll)/.test(getComputedStyle(current).overflowY)) current = current.parentElement
    if (!current) return -1
    current.scrollTop = top
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return current.scrollTop
  }, top)
}

/** Accessible name (aria-label or text) of the focused element. */
export async function focusedName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    if (!active || active === document.body) return null
    return active.getAttribute('aria-label') ?? active.textContent?.trim() ?? null
  })
}

/** Names of the cards rendered in a grid, in DOM order (the rendered rows of a virtualized grid). */
export async function renderedCardNames(page: Page, name: string): Promise<string[]> {
  return grid(page, name).evaluate((element) =>
    Array.from(element.querySelectorAll<HTMLElement>('[data-roving-index]')).map((card) => card.getAttribute('aria-label') ?? '')
  )
}

/** Screen position of a card button, by its accessible name. */
export async function cardBox(page: Page, cardName: string) {
  return page.getByRole('button', { name: cardName, exact: true }).boundingBox()
}
