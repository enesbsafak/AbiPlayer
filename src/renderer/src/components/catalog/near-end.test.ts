import { describe, expect, it } from 'vitest'
import { isNearEnd } from './near-end'

describe('isNearEnd', () => {
  it('is near within one and a half viewports of the end', () => {
    expect(isNearEnd({ scrollTop: 0, clientHeight: 600, scrollHeight: 5000 })).toBe(false)
    // 900 px (1.5 × 600) or less left below the viewport.
    expect(isNearEnd({ scrollTop: 3500, clientHeight: 600, scrollHeight: 5000 })).toBe(true)
    expect(isNearEnd({ scrollTop: 3499, clientHeight: 600, scrollHeight: 5000 })).toBe(false)
    expect(isNearEnd({ scrollTop: 4400, clientHeight: 600, scrollHeight: 5000 })).toBe(true)
  })

  it('counts a list too short to scroll as at its end, so the next page fills the view', () => {
    expect(isNearEnd({ scrollTop: 0, clientHeight: 800, scrollHeight: 400 })).toBe(true)
  })
})
