import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import type { Channel } from '@/types/playlist'

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return {
    ...actual,
    mpvJumpToLive: vi.fn(() =>
      Promise.reject(
        new Error(
          "Error invoking remote method 'mpv-jump-to-live': CertificateTrustError: Sunucunun güvenlik sertifikası, güvendiğiniz sertifikadan farklı. Yeniden onaylamadan bağlanılmıyor."
        )
      )
    ),
    mpvTogglePause: vi.fn(() => Promise.resolve())
  }
})

import { mpvJumpToLive } from '@/services/platform'
import { PlayerControls } from './PlayerControls'

const live: Channel = { id: 'a', name: 'Kanal A', streamUrl: 'https://p.test/live/u/p/1.ts', sourceId: 's', type: 'live' }

afterEach(() => {
  cleanup()
  useStore.getState().stopPlayback()
  useStore.setState({ playbackEngine: 'html5' })
})

describe('PlayerControls', () => {
  // M1: resuming a paused live channel on mpv is a new load, and main may
  // refuse it now; the viewer is told instead of nothing happening.
  it('shows why mpv refused to resume a paused live channel', async () => {
    act(() => {
      useStore.getState().playChannel(live)
      useStore.setState({ playbackEngine: 'mpv', isPaused: true, isPlaying: false })
    })
    render(
      <MemoryRouter>
        <PlayerControls videoRef={{ current: null }} onToggleFullscreen={() => undefined} />
      </MemoryRouter>
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Oynat' }))
    })

    expect(vi.mocked(mpvJumpToLive)).toHaveBeenCalledTimes(1)
    expect(useStore.getState().playerError).toMatch(/sertifika/i)
    expect(useStore.getState().playerError).not.toContain('Error invoking')
  })
})
