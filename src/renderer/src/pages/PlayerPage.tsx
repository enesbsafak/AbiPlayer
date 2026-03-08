import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { navigateToPlayerReturnTarget } from '@/services/player-navigation'

export default function PlayerPage() {
  const navigate = useNavigate()
  const currentChannel = useStore((s) => s.currentChannel)
  const playerReturnTarget = useStore((s) => s.playerReturnTarget)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)

  useEffect(() => {
    setMiniPlayer(false)
  }, [setMiniPlayer])

  useEffect(() => {
    if (!currentChannel) {
      navigateToPlayerReturnTarget({ navigate, target: playerReturnTarget })
    }
  }, [currentChannel, navigate, playerReturnTarget])

  if (!currentChannel) return null

  return <VideoPlayer className="h-full w-full" />
}
