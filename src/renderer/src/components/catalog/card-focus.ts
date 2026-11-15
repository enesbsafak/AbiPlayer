/** What a card in a keyboard-navigable grid takes from the grid. */
export interface CardFocusProps {
  /** Spread on the card's main control: its roving tabindex and index. */
  focusProps?: { tabIndex: number; 'data-roving-index': number }
  /** tabIndex of the card's other controls, so Tab leaves the grid after the active card. */
  secondaryTabIndex?: number
}

