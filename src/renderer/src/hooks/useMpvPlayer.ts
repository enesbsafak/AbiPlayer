import { useEffect, useRef, useState } from 'react'
import {
  mpvOpen,
  mpvSetAudioPassthrough,
  mpvSetAudioTrack,
  mpvSetHardwareDecoding,
  mpvSetMute,
  mpvSetPlaybackTuning,
  mpvSetSubtitleStyle,
  mpvSetSubtitleTrack,
  mpvSetVideoTrack,
  mpvSetVolume,
  mpvStop,
  onWindowStateChange,
  subscribeMpvState,
  windowGetState,
  type MpvStateSnapshot
} from '@/services/platform'
import { perfMark, perfMpvOpen, perfMpvSnapshot } from '@/services/perf'
import { AUTO_VIDEO_QUALITY_ID, getMpvVideoTrackId } from '@/services/quality'
import {
  liveFormatFallback,
  resolveEngineStreamUrl,
  type LiveFormatSetting
} from '@/services/playback'
import { useStore } from '@/store'
import type { XtreamLiveFormat } from '@/types/xtream'
import { isLiveTarget, type PlaybackId } from '../../../shared/playback'
import {
  initialLiveFormatState,
  liveFormatFallbackNotice,
  stepLiveFormat,
  type LiveFormatState
} from '@/player/live-format-fallback'
import {
  MPV_STARTUP_OVERLAY_TIMEOUT_MS,
  isNewerSnapshot,
  isSnapshotForPlayback,
  isSnapshotLoaded,
  reconcileMpvSnapshot,
  shouldKeepStartupOverlay
} from '@/player/mpv-snapshot'
import { createReconnectDriver, type ReconnectDriver } from '@/player/reconnect-policy'
import { MPV_AUDIO_PREFIX, MPV_SUBTITLE_PREFIX, trackIndex } from '@/player/track-ids'
import { FRESH_TRACK_PREFERENCES, type TrackPreferenceState } from '@/player/track-reconciler'

export {
  MPV_STARTUP_OVERLAY_TIMEOUT_MS,
  isNewerSnapshot,
  isSnapshotForPlayback,
  reconcileMpvSnapshot,
  shouldKeepStartupOverlay
} from '@/player/mpv-snapshot'
export {
  CONNECTION_LOST_MESSAGE as MPV_CONNECTION_LOST_MESSAGE,
  MAX_RECONNECT_ATTEMPTS as MAX_AUTO_RECONNECT
} from '@/player/reconnect-policy'

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value))
}

const EMPTY_PLAYBACK_PATCH = {
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
}

/**
 * The playback this window last had mpv open, while mpv still has it. A hook
 * mounting for that same playback (the player route and the experimental
 * corner player hand it to each other) adopts it instead of loading it again.
 * One mpv per window, so one value per renderer.
 */
let heldPlaybackId: PlaybackId | null = null

/** The URL mpv plays for a playback and where its live format stands (F2-04). */
interface MpvStream {
  playbackId: PlaybackId
  url: string
  setting: LiveFormatSetting
  allowed: readonly XtreamLiveFormat[]
  liveFormat: LiveFormatState
}

/** Shared by the hosts for the same reason as `heldPlaybackId`. */
let currentStream: MpvStream | null = null

export function isMpvHoldingPlayback(playbackId: PlaybackId): boolean {
  return heldPlaybackId === playbackId
}

/** For tests: forget what mpv holds. */
export function resetMpvHeldPlayback(): void {
  heldPlaybackId = null
  currentStream = null
}

function stopMpv(): void {
  heldPlaybackId = null
  void mpvStop().catch(() => undefined)
}

export interface MpvPlayerOptions {
  /**
   * Asked when the hook unmounts: true leaves mpv playing for the next host
   * (the corner player). Without it unmounting stops mpv, as before.
   */
  keepPlayingOnUnmount?: () => boolean
}

/**
 * The mpv engine. Main pushes mpv's snapshots; this hook applies the ones
 * stamped with the current playback id (newest first, by `seq`) to the store,
 * opens each new playback, and runs the shared reconnect policy for live
 * streams. Returns whether the startup overlay should show.
 */
export function useMpvPlayer(enabled: boolean, options: MpvPlayerOptions = {}) {
  const keepPlayingOnUnmountRef = useRef(options.keepPlayingOnUnmount)
  keepPlayingOnUnmountRef.current = options.keepPlayingOnUnmount
  const preferencesRef = useRef<TrackPreferenceState>(FRESH_TRACK_PREFERENCES)
  const lastSeqRef = useRef<number | null>(null)
  /** Newest applied snapshot of the current playback. */
  const currentSnapshotRef = useRef<MpvStateSnapshot | null>(null)
  /** Load whose track selections were last pushed back to mpv. */
  const assertedLoadRef = useRef<number | null>(null)
  const windowFullscreenRef = useRef(false)
  const reconnectRef = useRef<ReconnectDriver | null>(null)
  const startupStartedAtRef = useRef<number | null>(null)
  const startupVisibleRef = useRef(false)
  const [isStartupVisible, setIsStartupVisible] = useState(false)
  // Select individually: a bare `useStore()` re-runs this hook on every store
  // write, and snapshots write several times per second.
  const currentPlayback = useStore((s) => s.currentPlayback)
  const mediaKey = currentPlayback?.mediaKey ?? null
  const currentAudioTrack = useStore((s) => s.currentAudioTrack)
  const currentSubtitleTrack = useStore((s) => s.currentSubtitleTrack)
  const currentVideoQuality = useStore((s) => s.currentVideoQuality)
  const settings = useStore((s) => s.settings)
  const playbackTuning = useStore((s) => s.playbackTuning)
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

  // Track preferences are applied once per item, not again on a reload.
  useEffect(() => {
    preferencesRef.current = FRESH_TRACK_PREFERENCES
  }, [enabled, mediaKey])

  // Full mpv teardown when disabled or on unmount. mpv keeps a playback it
  // holds for the host taking it over: on unmount when the host says so, and
  // while disabled (the player route mounts disabled until the engine is
  // known) when mpv holds the very playback that is current.
  useEffect(() => {
    const teardown = (unmounting: boolean) => {
      startupStartedAtRef.current = null
      startupVisibleRef.current = false
      reconnectRef.current?.dispose()
      reconnectRef.current = null
      if (unmounting && keepPlayingOnUnmountRef.current?.()) return
      const currentId = useStore.getState().currentPlayback?.playbackId ?? null
      if (!unmounting && currentId !== null && heldPlaybackId === currentId) return
      stopMpv()
    }
    if (enabled) return () => teardown(true)
    teardown(false)
  }, [enabled])

  // Declared ahead of the playback effect on purpose: effects run in
  // declaration order, so the controller learns the user's choice before mpv
  // loads anything. That matters because the failure this setting exists to
  // escape — a driver that black-screens on hardware decoding — would
  // otherwise happen during the moment mpv starts with the default.
  useEffect(() => {
    if (!enabled) return
    void mpvSetHardwareDecoding(settings.hardwareAcceleration).catch(() => undefined)
  }, [enabled, settings.hardwareAcceleration])

  useEffect(() => {
    if (!enabled) return
    void mpvSetAudioPassthrough(settings.audioPassthrough).catch(() => undefined)
  }, [enabled, settings.audioPassthrough])

  // Snapshots and window state. A renderer reload subscribes again and starts
  // from the full current snapshot.
  useEffect(() => {
    if (!enabled) return

    const applySnapshot = (snapshot: MpvStateSnapshot) => {
      if (!isNewerSnapshot(lastSeqRef.current, snapshot)) return
      lastSeqRef.current = snapshot.seq

      const store = useStore.getState()
      const playback = store.currentPlayback
      if (!playback || !isSnapshotForPlayback(snapshot, playback.playbackId)) return

      // A live channel that did not open in an explicitly chosen format gets
      // one try in the other one (F2-04); the failed load is not reported.
      const stream = currentStream
      if (stream && stream.playbackId === playback.playbackId) {
        const failed = stream.liveFormat.format
        const alternative = failed ? liveFormatFallback('mpv', stream.setting, stream.allowed, failed) : null
        const step = stepLiveFormat(stream.liveFormat, snapshot, alternative)
        currentStream = { ...stream, liveFormat: step.state }
        if (step.fallbackTo && failed) {
          const next = resolveEngineStreamUrl(playback, 'mpv', stream.setting, store, step.fallbackTo)
          currentStream = { ...currentStream, url: next.url }
          applyPlayerPatch({ playerNotice: liveFormatFallbackNotice(failed, step.fallbackTo) })
          perfMpvOpen(next.url)
          void mpvOpen(next.url, { playbackId: playback.playbackId }).catch(() => undefined)
        }
        if (step.ignore) return
      }

      currentSnapshotRef.current = snapshot
      perfMpvSnapshot(snapshot)

      if (startupVisibleRef.current && !shouldKeepStartupOverlay(snapshot, startupStartedAtRef.current)) {
        updateStartupVisibility(false)
      }

      const result = reconcileMpvSnapshot(snapshot, store, preferencesRef.current, windowFullscreenRef.current)
      preferencesRef.current = result.preferences
      if (Object.keys(result.patch).length > 0) applyPlayerPatch(result.patch)
      if (result.disableMpvSubtitles) void mpvSetSubtitleTrack(null).catch(() => undefined)

      if (snapshot.tracks.length > 0 && snapshot.loadId !== null && assertedLoadRef.current !== snapshot.loadId) {
        assertedLoadRef.current = snapshot.loadId
        reassertSelections(snapshot, preferencesRef.current.subtitlesOffByDefault)
      }

      // mpv has this load's file open: a resume seek can run.
      if (isSnapshotLoaded(snapshot)) store.markPlaybackLoaded(playback.playbackId)

      reconnectRef.current?.observe({
        isLive: isLiveTarget(playback.target),
        // Time-pos is unreliable as a liveness signal (many live feeds hold
        // it or reset it while healthy); mpv's demuxer underrun flag is not.
        progressing: snapshot.phase === 'playing' && !snapshot.buffering && !snapshot.paused,
        expectingProgress: !snapshot.paused && (snapshot.phase === 'loading' || snapshot.phase === 'playing'),
        error: snapshot.error,
        errorKey: snapshot.loadId
      })
    }

    const applyWindowFullscreen = (fullscreen: boolean) => {
      windowFullscreenRef.current = fullscreen
      const next = fullscreen || (currentSnapshotRef.current?.fullscreen ?? false)
      if (useStore.getState().isFullscreen !== next) applyPlayerPatch({ isFullscreen: next })
    }

    let active = true
    // The initial read can answer after an event; the event is newer then.
    let windowEventSeen = false
    const unsubscribe = subscribeMpvState(applySnapshot)
    const stopWindowEvents = onWindowStateChange((state) => {
      windowEventSeen = true
      applyWindowFullscreen(state.isFullScreen)
    })
    void windowGetState()
      .then((state) => {
        if (active && state && !windowEventSeen) applyWindowFullscreen(state.isFullScreen)
      })
      .catch(() => undefined)

    return () => {
      active = false
      unsubscribe?.()
      stopWindowEvents?.()
      lastSeqRef.current = null
    }
  }, [enabled, applyPlayerPatch])

  // One run per playback: a start, a reload ("Yeniden Bağlan" loads the same
  // stream again as a new playback) or a return from the mini card.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const playback = currentPlayback
    currentSnapshotRef.current = null
    assertedLoadRef.current = null
    reconnectRef.current?.dispose()
    reconnectRef.current = null

    if (!playback) {
      startupStartedAtRef.current = null
      currentStream = null
      updateStartupVisibility(false)
      stopMpv()
      applyPlayerPatch(EMPTY_PLAYBACK_PATCH)
      return
    }

    // mpv already plays this very playback: another host had it (the corner
    // player and the player route hand it to each other). Nothing is loaded
    // again and the startup overlay stays off.
    const adopted = heldPlaybackId === playback.playbackId
    let stream = currentStream
    if (!adopted || stream?.playbackId !== playback.playbackId) {
      // The live format is decided here, at the edge, for mpv (F2-04).
      const state = useStore.getState()
      const setting = state.settings.liveStreamFormat
      const resolved = resolveEngineStreamUrl(playback, 'mpv', setting, state)
      stream = {
        playbackId: playback.playbackId,
        url: resolved.url,
        setting,
        allowed: resolved.allowed,
        liveFormat: initialLiveFormatState(resolved.format)
      }
      currentStream = stream
    }
    const openUrl = stream.url

    // A reconnect reopens the same playback (same id, mpv keeps its tuning)
    // and is dropped if another one has started by the time it fires.
    reconnectRef.current = createReconnectDriver({
      showMessage: (message) => {
        if (!cancelled) applyPlayerPatch({ playerError: message })
      },
      reconnect: () => {
        if (cancelled) return
        // After a format fallback the stream URL is the other format's.
        const url = currentStream?.playbackId === playback.playbackId ? currentStream.url : openUrl
        void mpvOpen(url, { playbackId: playback.playbackId }).catch(() => undefined)
      }
    })

    if (adopted) {
      return () => {
        cancelled = true
      }
    }

    // Only the first launch shows the startup overlay, not a channel switch.
    const isFirstLaunch = startupStartedAtRef.current === null
    startupStartedAtRef.current = Date.now()
    if (isFirstLaunch) updateStartupVisibility(true)
    const overlayTimer = window.setTimeout(() => updateStartupVisibility(false), MPV_STARTUP_OVERLAY_TIMEOUT_MS)

    const open = async () => {
      try {
        heldPlaybackId = playback.playbackId
        perfMpvOpen(openUrl)
        await mpvOpen(openUrl, {
          playbackId: playback.playbackId,
          tuning: useStore.getState().playbackTuning
        })
        perfMark('mpv:open-resolved')
      } catch (error) {
        if (heldPlaybackId === playback.playbackId) heldPlaybackId = null
        if (cancelled) return
        startupStartedAtRef.current = null
        updateStartupVisibility(false)
        setPlaybackEngine('html5')
        setPlayerError(error instanceof Error ? error.message : 'mpv oynatım başlatılamadı')
      }
    }
    void open()

    return () => {
      cancelled = true
      window.clearTimeout(overlayTimer)
      // mpv is not stopped here: the next playback replaces this one in place
      // (loadfile replace). Full teardown is the enabled effect's.
    }
  }, [enabled, currentPlayback, applyPlayerPatch, setPlaybackEngine, setPlayerError])

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

  // A new playback carries its tuning in `mpvOpen`; this follows changes made
  // while it plays.
  useEffect(() => {
    if (!enabled) return
    void mpvSetPlaybackTuning(playbackTuning).catch(() => undefined)
  }, [enabled, playbackTuning])

  useEffect(() => {
    if (!enabled) return
    const index = trackIndex(currentAudioTrack, MPV_AUDIO_PREFIX)
    if (index !== null) void mpvSetAudioTrack(index).catch(() => undefined)
  }, [enabled, currentAudioTrack])

  useEffect(() => {
    if (!enabled || currentVideoQuality === null) return
    if (currentVideoQuality === AUTO_VIDEO_QUALITY_ID) {
      void mpvSetVideoTrack(null).catch(() => undefined)
      return
    }
    const index = getMpvVideoTrackId(currentVideoQuality)
    if (index !== null) void mpvSetVideoTrack(index).catch(() => undefined)
  }, [enabled, currentVideoQuality])

  useEffect(() => {
    if (!enabled) return
    if (currentSubtitleTrack === null) {
      applyPlayerPatch({ subtitleCues: [], activeSubtitleCues: [] })
      void mpvSetSubtitleTrack(null).catch(() => undefined)
      return
    }
    const index = trackIndex(currentSubtitleTrack, MPV_SUBTITLE_PREFIX)
    if (index === null) return
    applyPlayerPatch({ subtitleCues: [], activeSubtitleCues: [] })
    void mpvSetSubtitleTrack(index).catch(() => undefined)
  }, [enabled, currentSubtitleTrack, applyPlayerPatch])

  return enabled && startupStartedAtRef.current !== null && isStartupVisible
}

/**
 * A reconnect or reload starts a new load, and mpv picks its own default
 * tracks for it. The store still holds the viewer's (or the preference's)
 * choice and its effects will not send an unchanged value again, so the first
 * track list of every load gets the store's selections pushed back.
 */
function reassertSelections(snapshot: MpvStateSnapshot, subtitlesOffByDefault: boolean): void {
  const { currentAudioTrack, currentSubtitleTrack, isSubtitleTrackUserChoice } = useStore.getState()
  const audio = trackIndex(currentAudioTrack, MPV_AUDIO_PREFIX)
  if (audio !== null && audio !== snapshot.aid && hasTrack(snapshot, 'audio', audio)) {
    void mpvSetAudioTrack(audio).catch(() => undefined)
  }
  const subtitle = trackIndex(currentSubtitleTrack, MPV_SUBTITLE_PREFIX)
  if (subtitle !== null && subtitle !== snapshot.sid && hasTrack(snapshot, 'sub', subtitle)) {
    void mpvSetSubtitleTrack(subtitle).catch(() => undefined)
  } else if (
    currentSubtitleTrack === null &&
    snapshot.sid !== null &&
    (isSubtitleTrackUserChoice || subtitlesOffByDefault)
  ) {
    // Subtitles were turned off (by the viewer or the setting); keep them off.
    void mpvSetSubtitleTrack(null).catch(() => undefined)
  }
}

function hasTrack(snapshot: MpvStateSnapshot, type: 'audio' | 'sub', id: number): boolean {
  return snapshot.tracks.some((track) => track.type === type && track.id === id)
}
