import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { commandLine: { appendSwitch: vi.fn() } } }))

const { e2eWindowOptions } = await import('./e2e-mode')

describe('e2eWindowOptions', () => {
  it('creates the test window off-screen, out of the taskbar and unable to take focus', () => {
    expect(e2eWindowOptions(true)).toEqual({ x: -32000, y: -32000, focusable: false, skipTaskbar: true })
  })

  it('changes nothing outside test mode', () => {
    expect(e2eWindowOptions(false)).toEqual({})
  })
})
