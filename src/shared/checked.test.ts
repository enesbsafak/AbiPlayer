import { describe, expect, it } from 'vitest'
import { defined, itemAt } from './checked'

describe('defined', () => {
  it('returns a present value, falsy ones included', () => {
    expect(defined(0)).toBe(0)
    expect(defined('')).toBe('')
    expect(defined(null)).toBeNull()
  })

  it('throws on undefined, naming what was expected', () => {
    expect(() => defined(undefined, 'the stream id')).toThrow('Expected the stream id to be defined')
  })
})

describe('itemAt', () => {
  it('returns the element at an index inside the bounds', () => {
    expect(itemAt(['a', 'b'], 1)).toBe('b')
    expect(itemAt('xy', 0)).toBe('x')
  })

  it('throws outside the bounds and on non-integer indexes', () => {
    expect(() => itemAt(['a'], 1)).toThrow(RangeError)
    expect(() => itemAt(['a'], -1)).toThrow(RangeError)
    expect(() => itemAt(['a'], 0.5)).toThrow(RangeError)
  })
})
