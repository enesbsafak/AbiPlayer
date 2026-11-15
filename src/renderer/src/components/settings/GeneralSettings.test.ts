import { createElement } from 'react'
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useStore } from '@/store'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { strings } from '@/strings'
import { EpgRefreshIntervalInput, GeneralSettings } from './GeneralSettings'
import { useLanguageCodes } from './language-options'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

afterEach(() => {
  cleanup()
  useStore.setState({ settings: DEFAULT_SETTINGS })
})

function intervalInput(): HTMLInputElement {
  return screen.getByLabelText(strings.settings.general.epgInterval) as HTMLInputElement
}

describe('EPG refresh interval', () => {
  it('lets "120" be typed digit by digit and commits on blur', () => {
    render(createElement(EpgRefreshIntervalInput))
    const input = intervalInput()

    for (const value of ['1', '12', '120']) {
      fireEvent.change(input, { target: { value } })
      expect(input.value).toBe(value)
    }
    expect(useStore.getState().settings.epgRefreshInterval).toBe(60)

    fireEvent.blur(input)
    expect(useStore.getState().settings.epgRefreshInterval).toBe(120)
    expect(input.value).toBe('120')
  })

  it('clamps when committing with Enter', () => {
    render(createElement(EpgRefreshIntervalInput))
    const input = intervalInput()

    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(useStore.getState().settings.epgRefreshInterval).toBe(5)
    expect(input.value).toBe('5')
  })

  it('restores the saved value when the draft is not a number', () => {
    render(createElement(EpgRefreshIntervalInput))
    const input = intervalInput()

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(useStore.getState().settings.epgRefreshInterval).toBe(60)
    expect(input.value).toBe('60')
  })
})

describe('reset all settings', () => {
  it('asks first and keeps the TMDB key', () => {
    useStore.getState().updateSettings({ tmdbApiKey: 'anahtar', subtitleFontSize: 40 })
    render(createElement(GeneralSettings))

    fireEvent.click(screen.getByRole('button', { name: strings.settings.general.resetAll }))
    expect(useStore.getState().settings.subtitleFontSize).toBe(40)
    expect(screen.getByText(/TMDB anahtarın, kaynakların/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Sıfırla' }))
    expect(useStore.getState().settings.subtitleFontSize).toBe(DEFAULT_SETTINGS.subtitleFontSize)
    expect(useStore.getState().settings.tmdbApiKey).toBe('anahtar')
  })
})

describe('useLanguageCodes', () => {
  it('always offers the saved language', () => {
    const { result } = renderHook(() => useLanguageCodes('pt-br'))
    expect(result.current).toContain('pt-br')
  })

  it('does not add the non-language values', () => {
    const { result } = renderHook(() => useLanguageCodes('auto'))
    expect(result.current).not.toContain('auto')
  })
})
