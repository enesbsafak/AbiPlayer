import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const xtream = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('@/services/xtream-api', () => ({ xtreamApi: xtream }))
vi.mock('@/services/secure-credentials', () => ({
  secureCredentialService: { set: vi.fn().mockResolvedValue(undefined) }
}))

import { useStore } from '@/store'
import { LoginForm } from './LoginForm'

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Bağlan' }))
}

afterEach(() => {
  cleanup()
  useStore.setState({ sources: [], activeSourceId: null, xtreamAuth: {} })
})

describe('LoginForm', () => {
  it('trims the credentials before using them', async () => {
    xtream.authenticate.mockResolvedValue({ user_info: { auth: 1 }, server_info: {} })
    render(createElement(MemoryRouter, null, createElement(LoginForm)))

    fill('Sunucu URL', '  example.test:8080  ')
    fill('Kullanıcı Adı', ' ali \n')
    fill('Şifre', '\tgizli ')
    submit()

    await waitFor(() => expect(useStore.getState().sources).toHaveLength(1))
    expect(xtream.authenticate).toHaveBeenCalledWith({
      url: 'http://example.test:8080',
      username: 'ali',
      password: 'gizli'
    })
    const [source] = useStore.getState().sources
    expect(source.username).toBe('ali')
    expect(source.password).toBe('gizli')
    expect(source.name).toBe('ali@example.test:8080')
  })

  it('shows network failures in Turkish', async () => {
    xtream.authenticate.mockRejectedValue(new TypeError('Failed to fetch'))
    render(createElement(MemoryRouter, null, createElement(LoginForm)))

    fill('Sunucu URL', 'example.test')
    fill('Kullanıcı Adı', 'ali')
    fill('Şifre', 'gizli')
    submit()

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Sunucuya ulaşılamadı. İnternet bağlantınızı ve sunucu adresini kontrol edin.'
    )
  })
})
