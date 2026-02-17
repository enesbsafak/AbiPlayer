import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { VideoPlayer } from '@/components/player/VideoPlayer'

export default function PlayerPage() {
  const navigate = useNavigate()
  const { currentChannel, setMiniPlayer } = useStore()

  useEffect(() => {
    setMiniPlayer(false)
  }, [setMiniPlayer])

  useEffect(() => {
    if (!currentChannel) navigate('/')
  }, [currentChannel, navigate])

  if (!currentChannel) return null

  return <VideoPlayer className="h-full w-full" />
}
