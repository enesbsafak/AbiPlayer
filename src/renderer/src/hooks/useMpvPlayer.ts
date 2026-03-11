import { useEffect, useRef, useState } from 'react'
import type { AudioTrack, SubtitleTrack } from '@/types/player'
import {
  type MpvStateSnapshot,
  mpvGetState,
  mpvIsAvailable,
  mpvOpen,
  mpvSetAudioTrack,
  mpvSetMute,
  mpvSetSubtitleStyle,
  mpvSetSubtitleTrack,
  mpvSetVolume,
  mpvStop,
  windowIsFullscreen,
  type MpvTrackInfo
} from '@/services/platform'
import {
  pickPreferredAudioTrackId,
  pickPreferredSubtitleTrackId
} from '@/services/track-preferences'
import { useStore } from '@/store'

const MPV_AUDIO_TRACK_PREFIX = 'mpv-a:'
const MPV_SUBTITLE_TRACK_PREFIX = 'mpv-s:'
const MPV_STARTUP_OVERLAY_TIMEOUT_MS = 15000

export function shouldKeepStartupOverlay(
  snapshot: MpvStateSnapshot,
  expectedUrl: string | null,
  startedAt: number | null,
  now = Date.now()
): boolean {
  if (!expectedUrl || startedAt === null) return false
  if (snapshot.error) return false
  if (now - startedAt >= MPV_STARTUP_OVERLAY_TIMEOUT_MS) return false
  if (snapshot.buffering) return false
  if (snapshot.timePos > 0) return false
  if (snapshot.duration > 0) return false
  if (snapshot.tracks.length > 0) return false
  return true
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function mapAudioTracks(tracks: MpvTrackInfo[]): AudioTrack[] {
  return tracks
    .filter((track) => track.type === 'audio')
    .map((track, index) => ({
      id: `${MPV_AUDIO_TRACK_PREFIX}${track.id}`,
      name: track.title || track.lang || `Audio ${index + 1}`,
      lang: track.lang,
      default: track.selected
    }))
}

function mapSubtitleTracks(tracks: MpvTrackInfo[]): SubtitleTrack[] {
  return tracks
    .filter((track) => track.type === 'sub')
    .map((track, index) => ({
      id: `${MPV_SUBTITLE_TRACK_PREFIX}${track.id}`,
      name: track.title || track.lang || `Subtitle ${index + 1}`,
      lang: track.lang,
      type: track.external ? 'external' : 'embedded'
    }))
}

export function useMpvPlayer(enabled: boolean) {
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioPreferenceAppliedRef = useRef(false)
  const subtitlePreferenceAppliedRef = useRef(false)
  const startupUrlRef = useRef<string | null>(null)
  const startupStartedAtRef = useRef<number | null>(null)
  const startupVisibleRef = useRef(false)
  const [isStarting, setIsStarting] = useState(false)
  const {
    currentChannel,
    currentAudioTrack,
    currentSubtitleTrack,
    settings,
    volume,
    isMuted,
    setPlaybackEngine,
    setPlaying,
    setPaused,
    setBuffering,
    setCurrentTime,
    setDuration,
    setFullscreen,
    setPlayerError,
    setAudioTracks,
    setCurrentAudioTrack,
    setSubtitleTracks,
    setCurrentSubtitleTrack,
    setVideoQualityOptions,
    setCurrentVideoQuality,
    setActiveVideoQuality,
    setSubtitleCues,
    setActiveSubtitleCues,
    setVolume,
    setMuted
  } = useStore()

  const updateStartupVisibility = (next: boolean) => {
    if (startupVisibleRef.current === next) return
    startupVisibleRef.current = next
    setIsStarting(next)
  }

  useEffect(() => {
    audioPreferenceAppliedRef.current = false
    subtitlePreferenceAppliedRef.current = false
  }, [enabled, currentChannel?.id, currentChannel?.streamUrl])

  useEffect(() => {
    if (enabled) return
    startupUrlRef.current = null
    startupStartedAtRef.current = null
    updateStartupVisibility(false)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const syncChannel = async () => {
      const available = await mpvIsAvailable()
      if (cancelled) return

      if (!available) {
        startupUrlRef.current = null
        startupStartedAtRef.current = null
        updateStartupVisibility(false)
        setPlaybackEngine('html5')
        return
      }

      setPlaybackEngine('mpv')

      if (!currentChannel?.streamUrl) {
        startupUrlRef.current = null
        startupStartedAtRef.current = null
        updateStartupVisibility(false)
        await mpvStop().catch(() => undefined)
        setAudioTracks([])
        setSubtitleTracks([])
        setCurrentAudioTrack(null)
        setCurrentSubtitleTrack(null)
        setVideoQualityOptions([])
        setCurrentVideoQuality(null)
        setActiveVideoQuality(null)
        setSubtitleCues([])
        setActiveSubtitleCues([])
        setPlaying(false)
        setPaused(true)
        setBuffering(false)
        setCurrentTime(0)
        setDuration(0)
        return
      }

      try {
        const defaultVolume = clampVolume(settings.defaultVolume)
        startupUrlRef.current = currentChannel.streamUrl
        startupStartedAtRef.current = Date.now()
        updateStartupVisibility(true)
        setVolume(defaultVolume)
        setMuted(false)
        await mpvOpen(currentChannel.streamUrl)
        if (cancelled) return

        await Promise.allSettled([mpvSetVolume(defaultVolume), mpvSetMute(false)])
      } catch (error) {
        if (cancelled) return
        startupUrlRef.current = null
        startupStartedAtRef.current = null
        updateStartupVisibility(false)
        setPlaybackEngine('html5')
        setPlayerError(error instanceof Error ? error.message : 'mpv oynatim baslatilamadi')
      }
    }

    void syncChannel()

    return () => {
      cancelled = true
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      startupUrlRef.current = null
      startupStartedAtRef.current = null
      updateStartupVisibility(false)
      void mpvStop().catch(() => undefined)
    }
  }, [
    enabled,
    currentChannel,
    setActiveSubtitleCues,
    setAudioTracks,
    setBuffering,
    setCurrentAudioTrack,
    setCurrentSubtitleTrack,
    setVideoQualityOptions,
    setCurrentVideoQuality,
    setActiveVideoQuality,
    setCurrentTime,
    setDuration,
    setMuted,
    setPaused,
    setPlaybackEngine,
    setPlayerError,
    setPlaying,
    setSubtitleCues,
    setSubtitleTracks,
    setVolume
  ])

  useEffect(() => {
    if (!enabled) return

    const poll = async () => {
      const [snapshot, windowFullscreen] = await Promise.all([
        mpvGetState().catch(() => null),
        windowIsFullscreen().catch(() => false)
      ])
      if (!snapshot) return

      const now = Date.now()
      updateStartupVisibility(
        shouldKeepStartupOverlay(snapshot, startupUrlRef.current, startupStartedAtRef.current, now)
      )
      setPlaying(snapshot.running && !snapshot.paused)
      setPaused(snapshot.paused)
      setBuffering(snapshot.buffering)
      setCurrentTime(snapshot.timePos || 0)
      setDuration(snapshot.duration || 0)
      setFullscreen(Boolean(windowFullscreen || snapshot.fullscreen))
      if (snapshot.error) {
        setPlayerError(snapshot.error)
      } else {
        setPlayerError(null)
      }

      const nextAudioTracks = mapAudioTracks(snapshot.tracks)
      setAudioTracks(nextAudioTracks)

      const currentStoreAudioTrack = useStore.getState().currentAudioTrack
      const selectedAudioTrack = snapshot.aid ? `${MPV_AUDIO_TRACK_PREFIX}${snapshot.aid}` : null
      if (!audioPreferenceAppliedRef.current && nextAudioTracks.length > 0) {
        const preferredAudioLanguage = useStore.getState().settings.preferredAudioLanguage
        const preferredTrackId = pickPreferredAudioTrackId(nextAudioTracks, preferredAudioLanguage)
        const targetAudioTrack = preferredTrackId ?? selectedAudioTrack
        if (targetAudioTrack && currentStoreAudioTrack !== targetAudioTrack) {
          setCurrentAudioTrack(targetAudioTrack)
        } else if (!targetAudioTrack && currentStoreAudioTrack !== null) {
          setCurrentAudioTrack(null)
        }
        audioPreferenceAppliedRef.current = true
      } else if (selectedAudioTrack && currentStoreAudioTrack === null) {
        setCurrentAudioTrack(selectedAudioTrack)
      }

      const nextSubtitleTracks = mapSubtitleTracks(snapshot.tracks)
      setSubtitleTracks(nextSubtitleTracks)

      const selectedSubtitleTrack = snapshot.sid ? `${MPV_SUBTITLE_TRACK_PREFIX}${snapshot.sid}` : null
      const currentStoreSubtitleTrack = useStore.getState().currentSubtitleTrack
      if (!subtitlePreferenceAppliedRef.current) {
        const { defaultSubtitleEnabled, preferredSubtitleLanguage } = useStore.getState().settings

        if (!defaultSubtitleEnabled || nextSubtitleTracks.length === 0) {
          if (currentStoreSubtitleTrack !== null) {
            setCurrentSubtitleTrack(null)
          }
        } else {
          const preferredTrackId = pickPreferredSubtitleTrackId(
            nextSubtitleTracks,
            preferredSubtitleLanguage
          )
          const targetSubtitleTrack = preferredTrackId ?? selectedSubtitleTrack
          if (targetSubtitleTrack && currentStoreSubtitleTrack !== targetSubtitleTrack) {
            setCurrentSubtitleTrack(targetSubtitleTrack)
          } else if (!targetSubtitleTrack && currentStoreSubtitleTrack !== null) {
            setCurrentSubtitleTrack(null)
          }
        }
        subtitlePreferenceAppliedRef.current = true
      } else if (selectedSubtitleTrack && currentStoreSubtitleTrack === null) {
        setCurrentSubtitleTrack(selectedSubtitleTrack)
      }
    }

    void poll()
    pollTimerRef.current = setInterval(() => {
      void poll()
    }, 250)

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [
    enabled,
    setAudioTracks,
    setBuffering,
    setCurrentAudioTrack,
    setCurrentSubtitleTrack,
    setCurrentTime,
    setDuration,
    setFullscreen,
    setPaused,
    setPlayerError,
    setPlaying,
    setSubtitleTracks
  ])

  useEffect(() => {
    if (!enabled) return
    void mpvSetVolume(clampVolume(volume)).catch(() => undefined)
  }, [enabled, volume])

  useEffect(() => {
    if (!enabled) return
    void mpvSetMute(isMuted).catch(() => undefined)
  }, [enabled, isMuted])

  useEffect(() => {
    if (!enabled) return
    void mpvSetSubtitleStyle({
      fontSize: settings.subtitleFontSize,
      color: settings.subtitleColor,
      background: settings.subtitleBackground
    }).catch(() => undefined)
  }, [enabled, settings.subtitleBackground, settings.subtitleColor, settings.subtitleFontSize])

  useEffect(() => {
    if (!enabled || !currentAudioTrack?.startsWith(MPV_AUDIO_TRACK_PREFIX)) return
    const rawId = Number.parseInt(currentAudioTrack.replace(MPV_AUDIO_TRACK_PREFIX, ''), 10)
    if (Number.isNaN(rawId)) return
    void mpvSetAudioTrack(rawId).catch(() => undefined)
  }, [enabled, currentAudioTrack])

  useEffect(() => {
    if (!enabled) return

    if (currentSubtitleTrack === null) {
      setSubtitleCues([])
      setActiveSubtitleCues([])
      void mpvSetSubtitleTrack(null).catch(() => undefined)
      return
    }

    if (!currentSubtitleTrack.startsWith(MPV_SUBTITLE_TRACK_PREFIX)) return

    const rawId = Number.parseInt(currentSubtitleTrack.replace(MPV_SUBTITLE_TRACK_PREFIX, ''), 10)
    if (Number.isNaN(rawId)) return
    setSubtitleCues([])
    setActiveSubtitleCues([])
    void mpvSetSubtitleTrack(rawId).catch(() => undefined)
  }, [enabled, currentSubtitleTrack, setActiveSubtitleCues, setSubtitleCues])

  return isStarting
}
