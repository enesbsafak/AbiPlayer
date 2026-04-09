import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MiniPlayer } from '@/components/player/MiniPlayer'
import { useStore } from '@/store'
import { useKeyboard } from '@/hooks/useKeyboard'
import { useEPG } from '@/hooks/useEPG'
import { useAutoConnect } from '@/hooks/useAutoConnect'

const LAST_ROUTE_KEY = 'iptv:last-route'
const RESTORABLE_ROUTES = new Set(['/live', '/vod', '/series', '/epg', '/favorites', '/search', '/settings'])

export function AppShell() {
  const location = useLocation()
  const restoredRef = useRef(false)
  const currentChannel = useStore((s) => s.currentChannel)
  const isMiniPlayer = useStore((s) => s.isMiniPlayer)
  const playbackEngine = useStore((s) => s.playbackEngine)
  const isPlayerRoute = location.pathname === '/player'

  useAutoConnect()
  useKeyboard()
  useEPG()

  // Save last visited route
  useEffect(() => {
    if (RESTORABLE_ROUTES.has(location.pathname)) {
      localStorage.setItem(LAST_ROUTE_KEY, location.pathname)
    }
  }, [location.pathname])

  // Always start from home page — bootstrap loads categories + preview first
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    localStorage.removeItem(LAST_ROUTE_KEY)
  }, [])

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
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-950 text-surface-50">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="relative flex-1 overflow-y-auto p-4">
            <Outlet />
          </main>
        </div>
      </div>
      {currentChannel && isMiniPlayer && <MiniPlayer />}
    </div>
  )
}
