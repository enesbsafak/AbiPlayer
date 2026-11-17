import { createContext, useContext } from 'react'

/**
 * Opens the stream picker for the add-on film or episode playing, or null
 * when what plays is not from an add-on. Provided by the player, read by
 * the dock's "Yayınlar" pill.
 */
export const AddonStreamChoiceContext = createContext<(() => void) | null>(null)

export function useAddonStreamChoice(): (() => void) | null {
  return useContext(AddonStreamChoiceContext)
}
