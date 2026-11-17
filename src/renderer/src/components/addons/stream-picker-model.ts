import type { AddonStreamCandidate, AddonStreamPreference, AddonStreamResult } from '@/addons/streams'
import { pickPreferredCandidate } from '@/addons/streams'

/*
 * The stream picker's state, without React: one entry per add-on asked, in
 * the order they were asked, each filled in as its answer arrives. What the
 * picker says as a whole (asking, nothing found, every add-on failed) and
 * whether the remembered choice can be played without asking are derived
 * from it.
 */

export interface PickerAddon {
  sourceId: string
  addonName: string
  status: 'asking' | 'candidates' | 'empty' | 'failed'
  candidates: AddonStreamCandidate[]
  /** Why the add-on did not answer, in words for the screen. */
  error: string | null
}

export interface StreamPickerState {
  addons: PickerAddon[]
}

export type StreamPickerPhase =
  /** No installed add-on gives streams for this item. */
  | 'no-addons'
  /** Waiting, and no candidate has come yet. */
  | 'asking'
  /** At least one candidate (other add-ons may still be asked). */
  | 'ready'
  /** Every add-on answered, none with a playable stream. */
  | 'none-found'
  /** Every add-on failed. */
  | 'all-failed'

export function initialPickerState(addons: ReadonlyArray<{ sourceId: string; addonName: string }>): StreamPickerState {
  return {
    addons: addons.map((addon) => ({
      sourceId: addon.sourceId,
      addonName: addon.addonName,
      status: 'asking',
      candidates: [],
      error: null
    }))
  }
}

/** The state with one add-on's answer in it. An answer from an add-on that was not asked is ignored. */
export function applyStreamResult(
  state: StreamPickerState,
  result: AddonStreamResult,
  messageOf: (error: unknown) => string
): StreamPickerState {
  const index = state.addons.findIndex((addon) => addon.sourceId === result.sourceId)
  if (index < 0) return state
  const previous = state.addons[index]!
  const next: PickerAddon =
    result.status === 'candidates'
      ? { ...previous, status: 'candidates', candidates: result.candidates, error: null }
      : result.status === 'empty'
        ? { ...previous, status: 'empty', candidates: [], error: null }
        : { ...previous, status: 'failed', candidates: [], error: messageOf(result.error) }
  const addons = state.addons.slice()
  addons[index] = next
  return { addons }
}

export function pickerPhase(state: StreamPickerState): StreamPickerPhase {
  if (state.addons.length === 0) return 'no-addons'
  if (state.addons.some((addon) => addon.candidates.length > 0)) return 'ready'
  if (state.addons.some((addon) => addon.status === 'asking')) return 'asking'
  if (state.addons.every((addon) => addon.status === 'failed')) return 'all-failed'
  return 'none-found'
}

/** Every candidate, add-on by add-on: the order the keyboard walks them in. */
export function pickerCandidates(state: StreamPickerState): AddonStreamCandidate[] {
  return state.addons.flatMap((addon) => addon.candidates)
}

export type AutoPickDecision =
  | { kind: 'play'; candidate: AddonStreamCandidate }
  /** The remembered add-on has not answered yet. */
  | { kind: 'wait' }
  /** Nothing to pick by itself: the viewer chooses. */
  | { kind: 'ask' }

/**
 * Whether the remembered choice (same add-on, same `bingeGroup`, as for the
 * previous episode) can be played without showing the candidates. Decided as
 * soon as the remembered add-on has answered; the others are not waited for.
 */
export function decideAutoPick(state: StreamPickerState, preference: AddonStreamPreference | null): AutoPickDecision {
  if (!preference?.bingeGroup) return { kind: 'ask' }
  const addon = state.addons.find((entry) => entry.sourceId === preference.sourceId)
  if (!addon) return { kind: 'ask' }
  if (addon.status === 'asking') return { kind: 'wait' }
  const candidate = pickPreferredCandidate(addon.candidates, preference)
  return candidate ? { kind: 'play', candidate } : { kind: 'ask' }
}

/** Where focus goes from `index` for a key, among `count` candidates; null when the key is not one of these. */
export function nextCandidateIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null
  switch (key) {
    case 'ArrowDown':
      return index < 0 ? 0 : Math.min(count - 1, index + 1)
    case 'ArrowUp':
      return index < 0 ? 0 : Math.max(0, index - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
