import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPartialize, useStore, type AppStore } from '@/store'
import { secureCredentialService } from '@/services/secure-credentials'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { strings } from '@/strings'
import { TmdbApiKeyInput } from './GeneralSettings'
import { saveTmdbApiKey } from './tmdb-api-key'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useStore.setState({ settings: DEFAULT_SETTINGS, tmdbKeyPlainPending: false })
})

describe('TMDB key (K10)', () => {
  it('goes to the secure store, and is used (never persisted) once stored', async () => {
    const store = vi.fn().mockResolvedValue(undefined)
    useStore.setState({ tmdbKeyPlainPending: true })

    await saveTmdbApiKey(' 0123456789abcdef0123456789abcdef ', store)

    expect(store).toHaveBeenCalledWith('0123456789abcdef0123456789abcdef')
    expect(useStore.getState().settings.tmdbApiKey).toBe('0123456789abcdef0123456789abcdef')
    expect(JSON.stringify(createPartialize()(useStore.getState() as AppStore))).not.toContain('0123456789abcdef')
  })

  it('keeps the previous key when the secure write fails, and refuses a malformed one', async () => {
    useStore.getState().updateSettings({ tmdbApiKey: 'old-key' })
    await expect(saveTmdbApiKey('new-key', vi.fn().mockRejectedValue(new Error('yazılamadı')))).rejects.toThrow('yazılamadı')
    expect(useStore.getState().settings.tmdbApiKey).toBe('old-key')
    await expect(saveTmdbApiKey('has space', vi.fn())).rejects.toThrow(/Geçersiz TMDB anahtarı/)
  })

  it('is saved from the settings field on blur', async () => {
    const setTmdbApiKey = vi.spyOn(secureCredentialService, 'setTmdbApiKey').mockResolvedValue()
    render(createElement(TmdbApiKeyInput))
    const input = screen.getByLabelText(strings.settings.general.tmdbKey)

    fireEvent.change(input, { target: { value: 'abcdef0123' } })
    // Typing alone stores nothing.
    expect(setTmdbApiKey).not.toHaveBeenCalled()
    fireEvent.blur(input)

    await waitFor(() => expect(useStore.getState().settings.tmdbApiKey).toBe('abcdef0123'))
    expect(setTmdbApiKey).toHaveBeenCalledWith('abcdef0123')
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Anahtar güvenli depoya kaydedildi.')
  })
})
