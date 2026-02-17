import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MiniPlayer } from '@/components/player/MiniPlayer'
import { Spinner } from '@/components/ui/Spinner'
import { useStore } from '@/store'
import { useKeyboard } from '@/hooks/useKeyboard'
import { useEPG } from '@/hooks/useEPG'
import { useAutoConnect } from '@/hooks/useAutoConnect'

export function AppShell() {
  const location = useLocation()
  const currentChannel = useStore((s) => s.currentChannel)
  const isMiniPlayer = useStore((s) => s.isMiniPlayer)
  const isLoading = useStore((s) => s.isLoading)
  const sources = useStore((s) => s.sources)
  const playbackEngine = useStore((s) => s.playbackEngine)
  const isPlayerRoute = location.pathname === '/player'

  useAutoConnect()
  useKeyboard()
  useEPG()

  useEffect(() => {
    const useTransparentSurface = isPlayerRoute && playbackEngine === 'mpv'
    const html = document.documentElement
    const body = document.body
    const root = document.getElementById('root')

    html.classList.toggle('mpv-native-surface', useTransparentSurface)
    body.classList.toggle('mpv-native-surface', useTransparentSurface)
    root?.classList.toggle('mpv-native-surface', useTransparentSurface)

    return () => {
      html.classList.remove('mpv-native-surface')
      body.classList.remove('mpv-native-surface')
      root?.classList.remove('mpv-native-surface')
    }
  }, [isPlayerRoute, playbackEngine])

  if (isPlayerRoute) {
    return (
      <div className="relative h-screen bg-transparent text-white">
        <main className="relative h-full overflow-hidden">
          <Outlet />
          {isLoading && sources.length > 0 && (
            <div className="pointer-events-none absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full border border-white/22 bg-white/12 px-3 py-1.5 text-xs text-surface-100 shadow-[0_8px_20px_rgba(0,0,0,0.3)] backdrop-blur-xl">
              <Spinner size={14} />
              <span>Kaynaklar baglaniyor...</span>
            </div>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-surface-950 text-surface-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_0%,rgba(132,188,255,0.24),transparent_34%),radial-gradient(circle_at_94%_2%,rgba(87,215,196,0.22),transparent_42%),radial-gradient(circle_at_50%_115%,rgba(109,148,232,0.22),transparent_56%),linear-gradient(150deg,rgba(12,22,42,0.95)_0%,rgba(16,30,56,0.9)_48%,rgba(10,22,44,0.94)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),transparent)]" />
      <TitleBar />
      <div className="relative flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="relative flex-1 overflow-y-auto px-3 pb-3">
            <Outlet />
            {isLoading && sources.length > 0 && (
              <div className="pointer-events-none absolute right-5 top-5 z-20 flex items-center gap-2 rounded-full border border-white/22 bg-white/12 px-3 py-1.5 text-xs text-surface-100 shadow-[0_12px_25px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                <Spinner size={14} />
                <span>Kaynaklar baglaniyor...</span>
              </div>
            )}
          </main>
        </div>
      </div>
      {currentChannel && isMiniPlayer && <MiniPlayer />}
    </div>
  )
}
