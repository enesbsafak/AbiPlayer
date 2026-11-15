import { createElement } from 'react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const homeRenders = vi.hoisted(() => ({ count: 0 }))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: () =>
    createElement('div', null, createElement('button', { type: 'button' }, 'Pencereyi kapat'), createElement(Outlet))
}))

vi.mock('@/pages/HomePage', () => ({
  default: function BrokenHome() {
    homeRenders.count += 1
    throw new Error('Cannot read properties of undefined (reading "map")')
  }
}))

vi.mock('@/pages/SettingsPage', () => ({
  default: () => createElement('h1', null, 'Ayarlar')
}))

import { appRoutes } from './index'

// jsdom prints every error thrown during render even when a boundary catches
// it; marking the event handled keeps the output readable.
const swallowWindowError = (event: ErrorEvent) => event.preventDefault()
beforeAll(() => window.addEventListener('error', swallowWindowError))
afterAll(() => window.removeEventListener('error', swallowWindowError))

beforeEach(() => {
  homeRenders.count = 0
  // React reports every caught render error; it is expected here.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(cleanup)

describe('route errors', () => {
  it('keep the shell when a page throws', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] })
    render(createElement(RouterProvider, { router }))

    expect(await screen.findByText('Sayfa yüklenemedi')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pencereyi kapat' })).toBeTruthy()
    expect(screen.getByText('Beklenmeyen bir hata oluştu.')).toBeTruthy()
  })

  it('do not send a broken home page back to itself', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] })
    render(createElement(RouterProvider, { router }))
    await screen.findByText('Sayfa yüklenemedi')

    expect(screen.queryByRole('button', { name: 'Ana Sayfaya Dön' })).toBeNull()

    const rendersBeforeRetry = homeRenders.count
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar Dene' }))
    await screen.findByText('Sayfa yüklenemedi')
    // One retry is one more attempt, not a cycle.
    expect(homeRenders.count - rendersBeforeRetry).toBeLessThanOrEqual(4)

    fireEvent.click(screen.getByRole('button', { name: 'Ayarlara Git' }))
    expect(await screen.findByRole('heading', { name: 'Ayarlar' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/settings')
  })
})
