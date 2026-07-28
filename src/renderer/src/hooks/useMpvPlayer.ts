import { useEffect, useRef, useState } from 'react'
import type { AudioTrack, SubtitleTrack, VideoQualityOption } from '@/types/player'
import {
  type MpvStateSnapshot,
  mpvGetState,
  mpvIsAvailable,
  mpvOpen,
  mpvSetAudioTrack,
  mpvSetMute,
  mpvSetSubtitleStyle,
  mpvSetSubtitleTrack,
  mpvSetVideoTrack,
  mpvSetVolume,
  mpvStop,
  windowIsFullscreen,
  type MpvTrackInfo
} from '@/services/platform'
import {
  AUTO_VIDEO_QUALITY_ID,
  buildMpvVideoQualityOptions,
  getActiveMpvVideoQualityId,
  getMpvVideoTrackId
} from '@/services/quality'
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
  // Stream is already playing — no overlay needed
  if (snapshot.timePos > 0) return false
  if (snapshot.tracks.length > 0) return false
  // MPV loaded a different path than we expected — it already moved on
  if (snapshot.path && snapshot.path !== expectedUrl) return false
  // MPV is running and processing the stream (buffering or playing)
  if (snapshot.running && !snapshot.paused) return false
  return true
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function mapAudioTracks(tracks: MpvTrackInfo[]): AudioTrack[] {
  const audioTracks: AudioTrack[] = []
  for (const track of tracks) {
    if (track.type !== 'audio') continue
    audioTracks.push({
      id: `${MPV_AUDIO_TRACK_PREFIX}${track.id}`,
      name: track.title || track.lang || `Audio ${audioTracks.length + 1}`,
      lang: track.lang,
      default: track.selected
    })
  }
  return audioTracks
}

function mapSubtitleTracks(tracks: MpvTrackInfo[]): SubtitleTrack[] {
  const subtitleTracks: SubtitleTrack[] = []
  for (const track of tracks) {
    if (track.type !== 'sub') continue
    subtitleTracks.push({
      id: `${MPV_SUBTITLE_TRACK_PREFIX}${track.id}`,
      name: track.title || track.lang || `Subtitle ${subtitleTracks.length + 1}`,
      lang: track.lang,
      type: track.external ? 'external' : 'embedded'
    })
  }
  return subtitleTracks
}

function getSelectedVideoTrackId(snapshot: MpvStateSnapshot): number | null {
  const selectedTrack = snapshot.tracks.find((track) => track.type === 'video' && track.selected)
  return selectedTrack?.id ?? snapshot.vid
}

// The poll below runs 4x/s and rebuilds these lists from scratch every tick.
// Writing them unconditionally would hand the store a fresh array reference on
// every tick and re-render every track/quality consumer, so compare by value
// and only publish real changes.
function sameAudioTracks(a: AudioTrack[], b: AudioTrack[]): boolean {
  if (a.length !== b.length) return false
  return a.every((track, index) => {
    const other = b[index]
    return (
      track.id === other.id &&
      track.name === other.name &&
      track.lang === other.lang &&
      track.default === other.default
    )
  })
}

function sameSubtitleTracks(a: SubtitleTrack[], b: SubtitleTrack[]): boolean {
  if (a.length !== b.length) return false
  return a.every((track, index) => {
    const other = b[index]
    return (
      track.id === other.id &&
      track.name === other.name &&
      track.lang === other.lang &&
      track.type === other.type
    )
  })
}

function sameQualityOptions(a: VideoQualityOption[], b: VideoQualityOption[]): boolean {
  if (a.length !== b.length) return false
  return a.every((option, index) => {
    const other = b[index]
    return option.id === other.id && option.label === other.label
  })
}

const MAX_AUTO_RECONNECT = 5
const RECONNECT_DELAY_MS = 1000
const STALL_THRESHOLD_MS = 12_000

export function useMpvPlayer(enabled: boolean) {
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioPreferenceAppliedRef = useRef(false)
  const subtitlePreferenceAppliedRef = useRef(false)
  const startupUrlRef = useRef<string | null>(null)
  const startupStartedAtRef = useRef<number | null>(null)
  const reconnectCountRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGoodPlaybackRef = useRef(0)
  const startupVisibleRef = useRef(false)
  const [isStartupVisible, setIsStartupVisible] = useState(false)
  // Select individually: a bare `useStore()` re-runs this hook on every store
  // write, and the poll below writes several times per second.
  const currentChannel = useStore((s) => s.currentChannel)
  const currentAudioTrack = useStore((s) => s.currentAudioTrack)
  const currentSubtitleTrack = useStore((s) => s.currentSubtitleTrack)
  const currentVideoQuality = useStore((s) => s.currentVideoQuality)
  const settings = useStore((s) => s.settings)
  const volume = useStore((s) => s.volume)
  const isMuted = useStore((s) => s.isMuted)
  const setPlaybackEngine = useStore((s) => s.setPlaybackEngine)
  const setPlayerError = useStore((s) => s.setPlayerError)
  const applyPlayerPatch = useStore((s) => s.applyPlayerPatch)

  const updateStartupVisibility = (next: boolean) => {
    if (startupVisibleRef.current === next) return
    startupVisibleRef.current = next
    setIsStartupVisible(next)
  }

  useEffect(() => {
    audioPreferenceAppliedRef.current = false
    subtitlePreferenceAppliedRef.current = false
  }, [enabled, currentChannel?.id, currentChannel?.streamUrl])

  // Full MPV teardown when disabled or component unmounts
  useEffect(() => {
    const teardown = () => {
      startupUrlRef.current = null
      startupStartedAtRef.current = null
      reconnectCountRef.current = 0
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      startupVisibleRef.current = false
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      void mpvStop().catch(() => undefined)
    }

    if (enabled) {
      return teardown // runs on unmount while enabled
    }
    teardown() // runs immediately when enabled becomes false
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
        applyPlayerPatch({
          audioTracks: [],
          subtitleTracks: [],
          currentAudioTrack: null,
          currentSubtitleTrack: null,
          videoQualityOptions: [],
          currentVideoQuality: null,
          activeVideoQuality: null,
          subtitleCues: [],
          activeSubtitleCues: [],
          isPlaying: false,
          isPaused: true,
          isBuffering: false,
          currentTime: 0,
          duration: 0,
          demuxerCacheDuration: 0
        })
        return
      }

      try {
        const { volume: currentVolume, isMuted: currentMuted } = useStore.getState()
        const safeVolume = clampVolume(currentVolume)
        // Only show startup overlay on first MPV launch, not on channel switches
        const isFirstLaunch = !startupUrlRef.current
        startupUrlRef.current = currentChannel.streamUrl
        startupStartedAtRef.current = Date.now()
        if (isFirstLaunch) updateStartupVisibility(true)
        await mpvOpen(currentChannel.streamUrl)
        if (cancelled) return

        await Promise.allSettled([mpvSetVolume(safeVolume), mpvSetMute(currentMuted)])
      } catch (error) {
        if (cancelled) return
        startupUrlRef.current = null
        startupStartedAtRef.current = null
        updateStartupVisibility(false)
        setPlaybackEngine('html5')
        setPlayerError(error instanceof Error ? error.message : 'mpv oynatım başlatılamadı')
      }
    }

    void syncChannel()

    return () => {
      cancelled = true
      // Don't stop MPV or reset refs here — this cleanup runs on every
      // channel switch (currentChannel dep change). MPV handles channel
      // switching natively via loadfile-replace. Full teardown only
      // happens when the enabled flag changes (separate effect).
    }
  }, [enabled, currentChannel, applyPlayerPatch, setPlaybackEngine, setPlayerError])

  useEffect(() => {
    if (!enabled) return

    const poll = async () => {
      const [snapshot, windowFullscreen] = await Promise.all([
        mpvGetState().catch(() => null),
        windowIsFullscreen().catch(() => false)
      ])
      if (!snapshot) return

      const now = Date.now()
      // Poll can only CLEAR the startup overlay, never re-enable it
      if (startupVisibleRef.current && !shouldKeepStartupOverlay(snapshot, startupUrlRef.current, startupStartedAtRef.current, now)) {
        updateStartupVisibility(false)
      }

      // Accumulate everything this tick observed into one patch and publish it
      // once, carrying only the keys whose value actually moved.
      const store = useStore.getState()
      const patch: Parameters<typeof applyPlayerPatch>[0] = {}

      const isPlayingNow = snapshot.running && !snapshot.paused
      if (store.isPlaying !== isPlayingNow) patch.isPlaying = isPlayingNow
      if (store.isPaused !== snapshot.paused) patch.isPaused = snapshot.paused
      if (store.isBuffering !== snapshot.buffering) patch.isBuffering = snapshot.buffering

      const timePos = snapshot.timePos || 0
      if (store.currentTime !== timePos) patch.currentTime = timePos

      const duration = snapshot.duration || 0
      if (store.duration !== duration) patch.duration = duration

      const cacheDuration = snapshot.demuxerCacheDuration || 0
      if (store.demuxerCacheDuration !== cacheDuration) patch.demuxerCacheDuration = cacheDuration

      const fullscreen = Boolean(windowFullscreen || snapshot.fullscreen)
      if (store.isFullscreen !== fullscreen) patch.isFullscreen = fullscreen

      // time-pos is unreliable as a liveness signal: many IPTV live streams
      // (proxied TS, HLS at segment boundaries, DVR-less feeds) hold it steady
      // or reset it while still healthily delivering frames. Trust mpv's own
      // demuxer underrun flag instead — it flips true only when the cache is
      // actually empty and no packets are arriving. The 12s threshold gives
      // mpv's own reconnect (reconnect_delay_max=5s) two attempts before we
      // forcibly reload.
      const isLiveStream = store.currentChannel?.type === 'live'
      if (snapshot.running && !snapshot.error && !snapshot.buffering) {
        lastGoodPlaybackRef.current = now
        reconnectCountRef.current = 0
      }

      const isStalledLive =
        isLiveStream &&
        !snapshot.error &&
        snapshot.running &&
        !snapshot.paused &&
        snapshot.buffering &&
        lastGoodPlaybackRef.current > 0 &&
        now - lastGoodPlaybackRef.current > STALL_THRESHOLD_MS

      // Auto-reconnect on error OR stall for live streams
      const needsReconnect = (snapshot.error || isStalledLive) && startupUrlRef.current && !reconnectTimerRef.current
      let nextPlayerError = store.playerError
      if (needsReconnect) {
        if (isLiveStream && reconnectCountRef.current < MAX_AUTO_RECONNECT) {
          reconnectCountRef.current++
          const delay = RECONNECT_DELAY_MS * reconnectCountRef.current
          nextPlayerError = `Bağlantı kesildi, yeniden bağlanılıyor... (${reconnectCountRef.current}/${MAX_AUTO_RECONNECT})`
          lastGoodPlaybackRef.current = now // reset stall timer
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null
            void mpvOpen(startupUrlRef.current!).catch(() => undefined)
          }, delay)
        } else if (snapshot.error) {
          nextPlayerError = snapshot.error
        }
      } else if (!snapshot.error && !isStalledLive) {
        nextPlayerError = null
      }
      if (store.playerError !== nextPlayerError) patch.playerError = nextPlayerError

      const nextAudioTracks = mapAudioTracks(snapshot.tracks)
      if (!sameAudioTracks(store.audioTracks, nextAudioTracks)) {
        patch.audioTracks = nextAudioTracks
      }

      const currentStoreAudioTrack = store.currentAudioTrack
      const selectedAudioTrack = snapshot.aid ? `${MPV_AUDIO_TRACK_PREFIX}${snapshot.aid}` : null
      if (!audioPreferenceAppliedRef.current && nextAudioTracks.length > 0) {
        const preferredTrackId = pickPreferredAudioTrackId(
          nextAudioTracks,
          store.settings.preferredAudioLanguage
        )
        const targetAudioTrack = preferredTrackId ?? selectedAudioTrack
        if (targetAudioTrack && currentStoreAudioTrack !== targetAudioTrack) {
          patch.currentAudioTrack = targetAudioTrack
        } else if (!targetAudioTrack && currentStoreAudioTrack !== null) {
          patch.currentAudioTrack = null
        }
        audioPreferenceAppliedRef.current = true
      } else if (selectedAudioTrack && currentStoreAudioTrack === null) {
        patch.currentAudioTrack = selectedAudioTrack
      }

      const nextSubtitleTracks = mapSubtitleTracks(snapshot.tracks)
      if (!sameSubtitleTracks(store.subtitleTracks, nextSubtitleTracks)) {
        patch.subtitleTracks = nextSubtitleTracks
      }

      const selectedSubtitleTrack = snapshot.sid ? `${MPV_SUBTITLE_TRACK_PREFIX}${snapshot.sid}` : null
      const currentStoreSubtitleTrack = store.currentSubtitleTrack
      if (!subtitlePreferenceAppliedRef.current) {
        const { defaultSubtitleEnabled, preferredSubtitleLanguage } = store.settings

        if (!defaultSubtitleEnabled || nextSubtitleTracks.length === 0) {
          if (currentStoreSubtitleTrack !== null) {
            patch.currentSubtitleTrack = null
          }
        } else {
          const preferredTrackId = pickPreferredSubtitleTrackId(
            nextSubtitleTracks,
            preferredSubtitleLanguage
          )
          const targetSubtitleTrack = preferredTrackId ?? selectedSubtitleTrack
          if (targetSubtitleTrack && currentStoreSubtitleTrack !== targetSubtitleTrack) {
            patch.currentSubtitleTrack = targetSubtitleTrack
          } else if (!targetSubtitleTrack && currentStoreSubtitleTrack !== null) {
            patch.currentSubtitleTrack = null
          }
        }
        subtitlePreferenceAppliedRef.current = true
      } else if (selectedSubtitleTrack && currentStoreSubtitleTrack === null) {
        patch.currentSubtitleTrack = selectedSubtitleTrack
      }

      const videoTracks = snapshot.tracks.filter((track) => track.type === 'video')
      const nextVideoQualityOptions = buildMpvVideoQualityOptions(videoTracks)
      if (!sameQualityOptions(store.videoQualityOptions, nextVideoQualityOptions)) {
        patch.videoQualityOptions = nextVideoQualityOptions
      }

      const activeVideoQuality = getActiveMpvVideoQualityId(getSelectedVideoTrackId(snapshot))
      if (store.activeVideoQuality !== activeVideoQuality) {
        patch.activeVideoQuality = activeVideoQuality
      }

      const currentStoreVideoQuality = store.currentVideoQuality
      if (nextVideoQualityOptions.length === 0) {
        if (currentStoreVideoQuality !== null) {
          patch.currentVideoQuality = null
        }
      } else if (
        currentStoreVideoQuality === null ||
        (
          currentStoreVideoQuality !== AUTO_VIDEO_QUALITY_ID &&
          !nextVideoQualityOptions.some((option) => option.id === currentStoreVideoQuality)
        )
      ) {
        patch.currentVideoQuality = AUTO_VIDEO_QUALITY_ID
      }

      if (Object.keys(patch).length > 0) applyPlayerPatch(patch)
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
  }, [enabled, applyPlayerPatch])

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
    if (!enabled || currentVideoQuality === null) return

    if (currentVideoQuality === AUTO_VIDEO_QUALITY_ID) {
      void mpvSetVideoTrack(null).catch(() => undefined)
      return
    }

    const rawId = getMpvVideoTrackId(currentVideoQuality)
    if (rawId === null) return
    void mpvSetVideoTrack(rawId).catch(() => undefined)
  }, [enabled, currentVideoQuality])

  useEffect(() => {
    if (!enabled) return

    if (currentSubtitleTrack === null) {
      applyPlayerPatch({ subtitleCues: [], activeSubtitleCues: [] })
      void mpvSetSubtitleTrack(null).catch(() => undefined)
      return
    }

    if (!currentSubtitleTrack.startsWith(MPV_SUBTITLE_TRACK_PREFIX)) return

    const rawId = Number.parseInt(currentSubtitleTrack.replace(MPV_SUBTITLE_TRACK_PREFIX, ''), 10)
    if (Number.isNaN(rawId)) return
    applyPlayerPatch({ subtitleCues: [], activeSubtitleCues: [] })
    void mpvSetSubtitleTrack(rawId).catch(() => undefined)
  }, [enabled, currentSubtitleTrack, applyPlayerPatch])

  return enabled && startupUrlRef.current !== null && isStartupVisible
}
