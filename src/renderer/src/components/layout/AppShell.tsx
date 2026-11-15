import { Suspense, lazy, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { HomeTopBar, InnerTopBar } from './TopBar'
import { screenFor } from './sections'
import { MiniPlayer } from '@/components/player/MiniPlayer'
import { clipPathOutside, useCornerRect } from '@/player/corner-rect'
import { CertificateTrustHost } from '@/components/security/CertificateTrustHost'
import { CredentialNotice } from '@/components/auth/CredentialNotice'
import { useStore } from '@/store'
import { useKeyboard } from '@/hooks/useKeyboard'
import { useEPG } from '@/hooks/useEPG'
import { useAutoConnect } from '@/hooks/useAutoConnect'
import { useWatchProgress } from '@/hooks/useWatchProgress'
import { usePerfMarkOnce } from '@/services/perf'

// Experimental and off by default: loaded (with the mpv engine hook) only
// when the corner player is shown.
const CornerPlayer = lazy(() => import('@/components/player/CornerPlayer'))

export function AppShell() {
  const routeLocation = useLocation()
  const currentChannel = useStore((s) => s.currentChannel)
  const isMiniPlayer = useStore((s) => s.isMiniPlayer)
  // Leaving the player by any route (search shortcut, a link) suspends playback
  // without setting the mini flag; the card must still offer the way back.
  const isPlaybackSuspended = useStore((s) => s.isPlaybackSuspended)
  const playbackEngine = useStore((s) => s.playbackEngine)
  const isPlayerRoute = routeLocation.pathname === '/player'
  const isHomeRoute = routeLocation.pathname === '/'
  // Experimental corner player (setting off by default; mpv only).
  const isCornerPlayback = useStore((s) => s.isCornerPlayback && s.currentPlayback !== null)
  const showCornerPlayer = isCornerPlayback && !isPlayerRoute

  useAutoConnect()
  useKeyboard()
  useEPG()
  // Lives here rather than in the player so it can write the final position
  // when the player route is left (playback is suspended there), on reload, on
  // stop and when the window closes.
  useWatchProgress()
  usePerfMarkOnce('renderer:shell-mounted')
  const cornerRect = useCornerRect(showCornerPlayer)

  useEffect(() => {
    const useTransparentSurface = (isPlayerRoute && playbackEngine === 'mpv') || showCornerPlayer
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
  }, [isPlayerRoute, playbackEngine, showCornerPlayer])

  if (isPlayerRoute) {
    return (
      <div className="relative h-screen bg-transparent text-white">
        <main className="relative h-full overflow-hidden">
          <Outlet />
        </main>
        <CertificateTrustHost />
      </div>
    )
  }

  return (
    <>
      <div
        className="flex h-screen flex-col overflow-hidden bg-ground text-white"
        style={showCornerPlayer ? { clipPath: clipPathOutside(cornerRect) } : undefined}
      >
        {/* No sidebar: home is a launcher with its own bar, every other
            screen has the inner bar with the way back and the section switcher. */}
        {isHomeRoute ? <HomeTopBar /> : <InnerTopBar screen={screenFor(routeLocation.pathname)} />}
        {/* Inner pages bring 12 px of their own padding (p-3); together the
            content sits on the bars' 24 px gutter and 20 px below them. */}
        <main className={`relative min-h-0 flex-1 overflow-y-auto ${isHomeRoute ? 'px-6 pb-4 pt-5 short:pb-3 short:pt-4' : 'px-3 pb-1 pt-2'}`}>
          <Outlet />
        </main>
        {currentChannel && !showCornerPlayer && (isMiniPlayer || isPlaybackSuspended) && <MiniPlayer />}
        <CertificateTrustHost />
        <CredentialNotice />
      </div>
      {showCornerPlayer && (
        <Suspense fallback={null}>
          <CornerPlayer rect={cornerRect} />
        </Suspense>
      )}
    </>
  )
}
