import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'

export function useKeyboard() {
  const navigate = useNavigate()
  const {
    currentChannel, isFullscreen, setFullscreen,
    volume, setVolume, isMuted, setMuted
  } = useStore()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          if (currentChannel) {
            const video = document.querySelector('video')
            if (video) video.paused ? video.play() : video.pause()
          }
          break

        case 'f':
        case 'F':
          e.preventDefault()
          if (currentChannel) {
            const container = document.querySelector('[data-player-container]') as HTMLElement
            if (container) {
              if (!document.fullscreenElement) {
                container.requestFullscreen()
                setFullscreen(true)
              } else {
                document.exitFullscreen()
                setFullscreen(false)
              }
            }
          }
          break

        case 'm':
        case 'M':
          e.preventDefault()
          setMuted(!isMuted)
          break

        case 'ArrowUp':
          e.preventDefault()
          setVolume(Math.min(1, volume + 0.05))
          break

        case 'ArrowDown':
          e.preventDefault()
          setVolume(Math.max(0, volume - 0.05))
          break

        case 'ArrowLeft':
          e.preventDefault()
          if (currentChannel) {
            const video = document.querySelector('video')
            if (video && isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime - 10)
          }
          break

        case 'ArrowRight':
          e.preventDefault()
          if (currentChannel) {
            const video = document.querySelector('video')
            if (video && isFinite(video.duration)) video.currentTime = Math.min(video.duration, video.currentTime + 10)
          }
          break

        case 'Escape':
          if (document.fullscreenElement) {
            document.exitFullscreen()
            setFullscreen(false)
          }
          break
      }

      // Ctrl/Cmd + K for search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        navigate('/search')
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [currentChannel, isFullscreen, volume, isMuted, setVolume, setMuted, setFullscreen, navigate])
}
