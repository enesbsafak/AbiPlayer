import { describe, expect, it } from 'vitest'
import type { AddonStreamCandidate, AddonStreamResult } from '@/addons/streams'
import {
  applyStreamResult,
  decideAutoPick,
  initialPickerState,
  nextCandidateIndex,
  pickerCandidates,
  pickerPhase
} from './stream-picker-model'

function candidate(overrides: Partial<AddonStreamCandidate> = {}): AddonStreamCandidate {
  return {
    handle: 'h1',
    sourceId: 'ak',
    addonName: 'Örnek Akış',
    name: '1080p',
    description: 'Örnek dosya',
    bingeGroup: 'grup-1080',
    filename: null,
    videoSize: null,
    notWebReady: false,
    ...overrides
  }
}

const TWO = [
  { sourceId: 'ak', addonName: 'Örnek Akış' },
  { sourceId: 'ak2', addonName: 'İkinci Akış' }
]
const message = () => 'Sunucu zamanında yanıt vermedi.'

function apply(state: ReturnType<typeof initialPickerState>, ...results: AddonStreamResult[]) {
  return results.reduce((current, result) => applyStreamResult(current, result, message), state)
}

const failed = (sourceId: string): AddonStreamResult => ({
  sourceId,
  addonName: sourceId,
  status: 'failed',
  error: { kind: 'timeout', message: 'zaman aşımı', retryable: true }
})
const empty = (sourceId: string): AddonStreamResult => ({ sourceId, addonName: sourceId, status: 'empty' })
const found = (sourceId: string, candidates: AddonStreamCandidate[]): AddonStreamResult => ({
  sourceId,
  addonName: sourceId,
  status: 'candidates',
  candidates
})

describe('the picker state', () => {
  it('says there is no stream add-on when none was asked', () => {
    expect(pickerPhase(initialPickerState([]))).toBe('no-addons')
  })

  it('asks every add-on and fills in each answer as it arrives, in the order asked', () => {
    let state = initialPickerState(TWO)
    expect(pickerPhase(state)).toBe('asking')
    state = apply(state, found('ak2', [candidate({ handle: 'b', sourceId: 'ak2' })]))
    // Candidates show while another add-on is still asked.
    expect(pickerPhase(state)).toBe('ready')
    expect(state.addons.map((addon) => addon.status)).toEqual(['asking', 'candidates'])
    state = apply(state, found('ak', [candidate({ handle: 'a' })]))
    expect(pickerCandidates(state).map((entry) => entry.handle)).toEqual(['a', 'b'])
  })

  it('tells nothing found from every add-on failing, and keeps each failure in words', () => {
    expect(pickerPhase(apply(initialPickerState(TWO), empty('ak'), failed('ak2')))).toBe('none-found')
    const allFailed = apply(initialPickerState(TWO), failed('ak'), failed('ak2'))
    expect(pickerPhase(allFailed)).toBe('all-failed')
    expect(allFailed.addons[0]?.error).toBe('Sunucu zamanında yanıt vermedi.')
  })

  it('ignores an answer from an add-on it did not ask', () => {
    const state = initialPickerState(TWO)
    expect(apply(state, found('baska', [candidate()]))).toBe(state)
  })
})

describe('the remembered choice', () => {
  const preference = { sourceId: 'ak', bingeGroup: 'grup-1080' }

  it('plays the same add-on and release by itself as soon as that add-on answers', () => {
    let state = initialPickerState(TWO)
    expect(decideAutoPick(state, preference)).toEqual({ kind: 'wait' })
    // Another add-on answering first changes nothing.
    state = apply(state, found('ak2', [candidate({ handle: 'x', sourceId: 'ak2' })]))
    expect(decideAutoPick(state, preference)).toEqual({ kind: 'wait' })
    const same = candidate({ handle: 'same' })
    state = apply(state, found('ak', [candidate({ handle: 'other', bingeGroup: 'grup-720' }), same]))
    expect(decideAutoPick(state, preference)).toEqual({ kind: 'play', candidate: same })
  })

  it('asks the viewer without a preference, without its add-on, or without that release', () => {
    const state = apply(initialPickerState(TWO), found('ak', [candidate({ bingeGroup: 'grup-720' })]))
    expect(decideAutoPick(state, null)).toEqual({ kind: 'ask' })
    expect(decideAutoPick(state, { sourceId: 'ak', bingeGroup: null })).toEqual({ kind: 'ask' })
    expect(decideAutoPick(state, { sourceId: 'kaldirildi', bingeGroup: 'grup-1080' })).toEqual({ kind: 'ask' })
    expect(decideAutoPick(state, preference)).toEqual({ kind: 'ask' })
    expect(decideAutoPick(apply(initialPickerState(TWO), failed('ak')), preference)).toEqual({ kind: 'ask' })
  })
})

describe('keyboard', () => {
  it('moves between candidates with the arrows, Home and End, and stops at the ends', () => {
    expect(nextCandidateIndex('ArrowDown', -1, 3)).toBe(0)
    expect(nextCandidateIndex('ArrowDown', 1, 3)).toBe(2)
    expect(nextCandidateIndex('ArrowDown', 2, 3)).toBe(2)
    expect(nextCandidateIndex('ArrowUp', 0, 3)).toBe(0)
    expect(nextCandidateIndex('ArrowUp', 2, 3)).toBe(1)
    expect(nextCandidateIndex('Home', 2, 3)).toBe(0)
    expect(nextCandidateIndex('End', 0, 3)).toBe(2)
    expect(nextCandidateIndex('Enter', 0, 3)).toBeNull()
    expect(nextCandidateIndex('ArrowDown', -1, 0)).toBeNull()
  })
})
