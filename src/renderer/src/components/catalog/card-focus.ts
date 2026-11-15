/** What a card in a keyboard-navigable grid takes from the grid. */
export interface CardFocusProps {
  /** Spread on the card's main control: its roving tabindex and index. */
  focusProps?: { tabIndex: number; 'data-roving-index': number }
  /** tabIndex of the card's other controls, so Tab leaves the grid after the active card. */
  secondaryTabIndex?: number
}

/**
 * A clear ring around the whole card while its main control has keyboard
 * focus (the control itself is clipped by the card's rounded overflow).
 */
export const CARD_FOCUS_CLASS =
  'has-[:focus-visible]:border-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface-950'
