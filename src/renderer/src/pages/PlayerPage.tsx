import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { navigateToPlayerReturnTarget } from '@/services/player-navigation'

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
  useEffect(() => {
    useStore.getState().resumeSuspendedPlayback()
    return () => useStore.getState().suspendPlayback()
  }, [])

  if (!currentChannel) return null

  return <VideoPlayer className="h-full w-full" />
}
