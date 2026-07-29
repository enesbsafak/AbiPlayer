import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRetainedListWhileLoading } from './useRetainedListWhileLoading'

type Props = { items: string[]; loading: boolean; resetKey: string | null }

function render(initial: Props) {
  return renderHook(({ items, loading, resetKey }: Props) =>
    useRetainedListWhileLoading(items, loading, resetKey), { initialProps: initial })
}

describe('useRetainedListWhileLoading', () => {
  it('passes the list straight through when not loading', () => {
    const { result } = render({ items: ['a', 'b'], loading: false, resetKey: 'k1' })
    expect(result.current).toEqual(['a', 'b'])
  })

  it('keeps the previous list while a load briefly empties it', () => {
    const { result, rerender } = render({ items: ['a', 'b'], loading: false, resetKey: 'k1' })

    rerender({ items: [], loading: true, resetKey: 'k1' })

    // Without retention the grid would flash empty here.
    expect(result.current).toEqual(['a', 'b'])
  })

  it('switches to the new list as soon as it arrives', () => {
    const { result, rerender } = render({ items: ['a', 'b'], loading: false, resetKey: 'k1' })

    rerender({ items: [], loading: true, resetKey: 'k1' })
    rerender({ items: ['c'], loading: false, resetKey: 'k1' })

    expect(result.current).toEqual(['c'])
  })

  it('never shows the previous scope after resetKey changes', () => {
    const { result, rerender } = render({ items: ['a', 'b'], loading: false, resetKey: 'k1' })

    // Category switch: loading starts and the filtered list is momentarily
    // empty. Showing ['a','b'] here would render the OLD category's channels.
    rerender({ items: [], loading: true, resetKey: 'k2' })
    expect(result.current).toEqual([])

    // Still loading a render later — the stale list must stay gone.
    rerender({ items: [], loading: true, resetKey: 'k2' })
    expect(result.current).toEqual([])

    rerender({ items: ['x'], loading: false, resetKey: 'k2' })
    expect(result.current).toEqual(['x'])
  })

  it('retains again within the new scope once it has content', () => {
    const { result, rerender } = render({ items: ['a'], loading: false, resetKey: 'k1' })

    rerender({ items: [], loading: true, resetKey: 'k2' })
    rerender({ items: ['x', 'y'], loading: false, resetKey: 'k2' })
    rerender({ items: [], loading: true, resetKey: 'k2' })

    expect(result.current).toEqual(['x', 'y'])
  })

  it('does not retain an empty list captured mid-load', () => {
    const { result, rerender } = render({ items: [], loading: true, resetKey: 'k1' })

    rerender({ items: [], loading: true, resetKey: 'k1' })
    expect(result.current).toEqual([])

    rerender({ items: ['a'], loading: false, resetKey: 'k1' })
    expect(result.current).toEqual(['a'])
  })
})
