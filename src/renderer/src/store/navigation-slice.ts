import type { StateCreator } from 'zustand'
import type { PlayerReturnTarget } from '@/types/navigation'

export interface NavigationSlice {
  playerReturnTarget: PlayerReturnTarget | null
  setPlayerReturnTarget: (target: PlayerReturnTarget | null) => void
  clearPlayerReturnTarget: () => void
}

export const createNavigationSlice: StateCreator<NavigationSlice, [], [], NavigationSlice> = (set) => ({
  playerReturnTarget: null,
  setPlayerReturnTarget: (target) => set({ playerReturnTarget: target }),
  clearPlayerReturnTarget: () => set({ playerReturnTarget: null })
})
