import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dropdown } from './Dropdown'

const ITEMS = [
  { id: 'a', label: 'Birinci' },
  { id: 'b', label: 'İkinci' },
  { id: 'c', label: 'Üçüncü' }
]

function renderDropdown(value = 'b') {
  const onSelect = vi.fn()
  render(createElement(Dropdown, { items: ITEMS, value, onSelect, id: 'dd' }))
  return { onSelect, trigger: screen.getByRole('button', { name: 'İkinci' }) }
}

afterEach(cleanup)

describe('Dropdown', () => {
  it('opens a menu from the keyboard with the selected entry focused', () => {
    const { trigger } = renderDropdown()

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    expect(screen.getByRole('menu')).toBeTruthy()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitemradio')
    expect(items).toHaveLength(3)
    expect(document.activeElement).toBe(items[1])
    expect(items[1].getAttribute('aria-checked')).toBe('true')
  })

  it('moves with the arrow keys and wraps around', () => {
    const { trigger } = renderDropdown()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu')
    const items = screen.getAllByRole('menuitemradio')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('closes on Escape and returns focus to the trigger', () => {
    const { trigger, onSelect } = renderDropdown()
    fireEvent.keyDown(trigger, { key: 'Enter' })

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('picks an entry and returns focus to the trigger', () => {
    const { trigger, onSelect } = renderDropdown()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })

    // Enter on a focused button is a native click.
    fireEvent.click(document.activeElement as HTMLElement)

    expect(onSelect).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('uses the Turkish placeholder', () => {
    render(createElement(Dropdown, { items: ITEMS, onSelect: () => {} }))
    expect(screen.getByRole('button', { name: 'Seçiniz...' })).toBeTruthy()
  })
})
