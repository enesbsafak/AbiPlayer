import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { navigateToPlayerReturnTarget } from '@/services/player-navigation'
import {
  mpvSeek,
  mpvSetFullscreen,
  mpvSetMute,
  mpvSetVolume,
  mpvTogglePause,
  windowSetFullscreen
} from '@/services/platform'

// Inputs that do not take typed text. Clicking one of these (the seek bar, the
// volume slider) focuses it, and treating it as a text field switched every
// shortcut off until the viewer clicked somewhere else.
const NON_TEXT_INPUT_TYPES = new Set([
  'range',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'color',
  'file',
  'image'
])

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type)
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable === true)
  )
}

export type KeyboardShortcut =
  | 'search'
  | 'toggle-play'
  | 'toggle-fullscreen'
  | 'toggle-mute'
  | 'volume-up'
  | 'volume-down'
  | 'seek-back'
  | 'seek-forward'
  | 'toggle-sidebar'
  | 'escape'

type ShortcutKeyEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>

/**
 * Maps a key press to the shortcut it triggers, or null to leave it alone.
 *
 * Playback keys only belong to the player screen. Elsewhere Space activates the
 * focused button and the arrows scroll the catalog, and the mini player is a
 * paused card with nothing to control, so claiming them there breaks both.
 */
export function resolveKeyboardShortcut(
  event: ShortcutKeyEvent,
  context: { pathname: string; hasChannel: boolean }
): KeyboardShortcut | null {
  if (isTextEntryTarget(event.target)) return null

  const hasModifier = event.metaKey || event.ctrlKey || event.altKey
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') return 'search'
  if (event.key === 'Escape') return 'escape'

  if (!context.hasChannel || context.pathname !== '/player') return null

  switch (event.key) {
    case ' ':
    case 'k':
      return hasModifier ? null : 'toggle-play'
    case 'f':
    case 'F':
      return 'toggle-fullscreen'
    case 'm':
    case 'M':
      return 'toggle-mute'
    case 'ArrowUp':
      return 'volume-up'
    case 'ArrowDown':
      return 'volume-down'
    case 'ArrowLeft':
      return 'seek-back'
    case 'ArrowRight':
      return 'seek-forward'
    case 'l':
    case 'L':
      return hasModifier ? null : 'toggle-sidebar'
    default:
      return null
  }
}

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
  const playerReturnTarget = useStore((s) => s.playerReturnTarget)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const togglePlayerSidebar = useStore((s) => s.togglePlayerSidebar)
  const isPlayerSidebarOpen = useStore((s) => s.isPlayerSidebarOpen)
  const setPlayerSidebarOpen = useStore((s) => s.setPlayerSidebarOpen)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const shortcut = resolveKeyboardShortcut(e, {
        pathname: location.pathname,
        hasChannel: !!currentChannel
      })
      if (!shortcut) return
      const isPlayerRoute = location.pathname === '/player'

      switch (shortcut) {
        case 'search':
          e.preventDefault()
          void navigate('/search')
          break

        case 'toggle-play':
          e.preventDefault()
          if (playbackEngine === 'mpv') {
            void mpvTogglePause().catch(() => undefined)
          } else {
            const video = document.querySelector('video')
            if (video?.paused) {
              // A refused play() (autoplay policy, a source swap) just leaves it paused.
              void video.play().catch(() => undefined)
            } else {
              video?.pause()
            }
          }
          break

        case 'toggle-fullscreen':
          e.preventDefault()
          if (playbackEngine === 'mpv') {
            const next = !isFullscreen
            setFullscreen(next)
            void Promise.allSettled([windowSetFullscreen(next), mpvSetFullscreen(next)])
          } else {
            const container = document.querySelector('[data-player-container]') as HTMLElement
            if (container) {
              // The store follows the browser only once it actually switched.
              if (!document.fullscreenElement) {
                void container.requestFullscreen().then(() => setFullscreen(true), () => undefined)
              } else {
                void document.exitFullscreen().then(() => setFullscreen(false), () => undefined)
              }
            }
          }
          break

        case 'toggle-mute':
          e.preventDefault()
          {
            const next = !isMuted
            setMuted(next)
            if (playbackEngine === 'mpv') {
              void mpvSetMute(next).catch(() => undefined)
            }
          }
          break

        case 'volume-up':
          e.preventDefault()
          {
            const next = Math.min(1, volume + 0.05)
            setVolume(next)
            if (playbackEngine === 'mpv') {
              void mpvSetVolume(next).catch(() => undefined)
            }
          }
          break

        case 'volume-down':
          e.preventDefault()
          {
            const next = Math.max(0, volume - 0.05)
            setVolume(next)
            if (playbackEngine === 'mpv') {
              void mpvSetVolume(next).catch(() => undefined)
            }
          }
          break

        case 'seek-back':
          e.preventDefault()
          if (playbackEngine === 'mpv') {
            void mpvSeek(-10).catch(() => undefined)
          } else {
            const video = document.querySelector('video')
            if (video && isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime - 10)
          }
          break

        case 'seek-forward':
          e.preventDefault()
          if (playbackEngine === 'mpv') {
            void mpvSeek(10).catch(() => undefined)
          } else {
            const video = document.querySelector('video')
            if (video && isFinite(video.duration)) video.currentTime = Math.min(video.duration, video.currentTime + 10)
          }
          break

        case 'toggle-sidebar':
          e.preventDefault()
          togglePlayerSidebar()
          break

        case 'escape':
          // Close sidebar first, then handle fullscreen/exit
          if (isPlayerRoute && isPlayerSidebarOpen) {
            e.preventDefault()
            setPlayerSidebarOpen(false)
            break
          }
          if (playbackEngine === 'mpv' && isFullscreen) {
            e.preventDefault()
            setFullscreen(false)
            void Promise.allSettled([windowSetFullscreen(false), mpvSetFullscreen(false)])
          } else if (document.fullscreenElement) {
            void document.exitFullscreen().then(() => setFullscreen(false), () => undefined)
          } else if (isPlayerRoute && currentChannel) {
            e.preventDefault()
            setMiniPlayer(true)
            navigateToPlayerReturnTarget({ navigate, target: playerReturnTarget })
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
    playerReturnTarget,
    setMiniPlayer,
    togglePlayerSidebar,
    isPlayerSidebarOpen,
    setPlayerSidebarOpen
  ])
}
