import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import {
  mpvSeek,
  mpvSetFullscreen,
  mpvSetMute,
  mpvSetVolume,
  mpvTogglePause,
  windowSetFullscreen
} from '@/services/platform'

export function useKeyboard() {
  const location = useLocation()
  const navigate = useNavigate()
  const currentChannel = useStore((s) => s.currentChannel)
  const playbackEngine = useStore((s) => s.playbackEngine)
  const isFullscreen = useStore((s) => s.isFullscreen)
  const setFullscreen = useStore((s) => s.setFullscreen)
  const volume = useStore((s) => s.volume)
  const setVolume = useStore((s) => s.setVolume)
  const isMuted = useStore((s) => s.isMuted)
  const setMuted = useStore((s) => s.setMuted)
  const stopPlayback = useStore((s) => s.stopPlayback)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navigate('/search')
        return
      }

      switch (e.key) {
        case ' ':
        case 'k':
          if (e.metaKey || e.ctrlKey || e.altKey) return
          e.preventDefault()
          if (currentChannel) {
            if (playbackEngine === 'mpv') {
              void mpvTogglePause().catch(() => undefined)
            } else {
              const video = document.querySelector('video')
              if (video) video.paused ? video.play() : video.pause()
            }
          }
          break

        case 'f':
        case 'F':
          e.preventDefault()
          if (currentChannel) {
            if (playbackEngine === 'mpv') {
              const next = !isFullscreen
              setFullscreen(next)
              void Promise.allSettled([windowSetFullscreen(next), mpvSetFullscreen(next)])
            } else {
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
          }
          break

        case 'm':
        case 'M':
          e.preventDefault()
          {
            const next = !isMuted
            setMuted(next)
            if (playbackEngine === 'mpv') {
              void mpvSetMute(next).catch(() => undefined)
            }
          }
          break

        case 'ArrowUp':
          e.preventDefault()
          {
            const next = Math.min(1, volume + 0.05)
            setVolume(next)
            if (playbackEngine === 'mpv') {
              void mpvSetVolume(next).catch(() => undefined)
            }
          }
          break

        case 'ArrowDown':
          e.preventDefault()
          {
            const next = Math.max(0, volume - 0.05)
            setVolume(next)
            if (playbackEngine === 'mpv') {
              void mpvSetVolume(next).catch(() => undefined)
            }
          }
          break

        case 'ArrowLeft':
          e.preventDefault()
          if (currentChannel) {
            if (playbackEngine === 'mpv') {
              void mpvSeek(-10).catch(() => undefined)
            } else {
              const video = document.querySelector('video')
              if (video && isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime - 10)
            }
          }
          break

        case 'ArrowRight':
          e.preventDefault()
          if (currentChannel) {
            if (playbackEngine === 'mpv') {
              void mpvSeek(10).catch(() => undefined)
            } else {
              const video = document.querySelector('video')
              if (video && isFinite(video.duration)) video.currentTime = Math.min(video.duration, video.currentTime + 10)
            }
          }
          break

        case 'Escape':
          if (playbackEngine === 'mpv' && isFullscreen) {
            e.preventDefault()
            setFullscreen(false)
            void Promise.allSettled([windowSetFullscreen(false), mpvSetFullscreen(false)])
          } else if (document.fullscreenElement) {
            document.exitFullscreen()
            setFullscreen(false)
          } else if (location.pathname === '/player' && currentChannel) {
            e.preventDefault()
            setMiniPlayer(false)
            stopPlayback()
            navigate('/')
          }
          break
      }

    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [
    currentChannel,
    playbackEngine,
    isFullscreen,
    volume,
    isMuted,
    setVolume,
    setMuted,
    setFullscreen,
    navigate,
    location.pathname,
    stopPlayback,
    setMiniPlayer
  ])
}
