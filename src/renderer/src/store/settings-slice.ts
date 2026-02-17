import type { StateCreator } from 'zustand'
import type { UserSettings } from '@/types/settings'
import { DEFAULT_SETTINGS } from '@/types/settings'

export interface SettingsSlice {
  settings: UserSettings
  updateSettings: (partial: Partial<UserSettings>) => void
  resetSettings: () => void
}

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set) => ({
  settings: DEFAULT_SETTINGS,
  updateSettings: (partial) =>
    set((state) => ({ settings: { ...state.settings, ...partial } })),
  resetSettings: () => set({ settings: DEFAULT_SETTINGS })
})
