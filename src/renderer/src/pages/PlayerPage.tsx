import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { navigateToPlayerReturnTarget } from '@/services/player-navigation'
import { perfMark } from '@/services/perf'
perfMark('route:player-chunk-loaded')

export default function PlayerPage() {
  const navigate = useNavigate()
  const currentChannel = useStore((s) => s.currentChannel)
  const playerReturnTarget = useStore((s) => s.playerReturnTarget)

  useEffect(() => {
    if (!currentChannel) {
      navigateToPlayerReturnTarget({ navigate, target: playerReturnTarget })
    }
  }, [currentChannel, navigate, playerReturnTarget])

  // Both engines live only on this route, so leaving it stops playback. Say so
  // in the store (and arm the resume) instead of leaving it claiming to play.
  // The experimental corner setting keeps mpv playing instead (AppShell shows
  // the corner player then).
  useEffect(() => {
    const store = useStore.getState()
    store.returnFromCornerPlayback()
    store.resumeSuspendedPlayback()
    return () => useStore.getState().leavePlayerRoute()
  }, [])

  if (!currentChannel) return null

  return <VideoPlayer className="h-full w-full" />
}
