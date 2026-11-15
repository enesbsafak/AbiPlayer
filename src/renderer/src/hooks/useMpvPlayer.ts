import { useEffect, useRef, useState } from 'react'
import type { AudioTrack, SubtitleTrack, VideoQualityOption } from '@/types/player'
import {
  type MpvStateSnapshot,
  mpvGetState,
  mpvIsAvailable,
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
import { isLiveTarget } from '../../../shared/playback'

const MPV_AUDIO_TRACK_PREFIX = 'mpv-a:'
const MPV_SUBTITLE_TRACK_PREFIX = 'mpv-s:'
const MPV_STARTUP_OVERLAY_TIMEOUT_MS = 15000

/**
 * A snapshot as the renderer reads it. Main is being changed to stamp each one
 * with the playback id it belongs to; until it does, `playbackId` is absent and
 * the loaded path is the only hint.
 */
export type MpvSnapshotLike = MpvStateSnapshot & { playbackId?: string | null }

/** The playback the renderer asked mpv to open. */
export interface MpvPlaybackRef {
  playbackId: string
  url: string
}

/** Whether a snapshot is about a different playback than `expected`. */
function belongsElsewhere(
  snapshot: Pick<MpvSnapshotLike, 'path' | 'playbackId'>,
  expected: MpvPlaybackRef
): boolean {
  if (snapshot.playbackId) return snapshot.playbackId !== expected.playbackId
  return !!snapshot.path && snapshot.path !== expected.url
}

export function shouldKeepStartupOverlay(
  snapshot: MpvSnapshotLike,
  expected: MpvPlaybackRef | null,
  startedAt: number | null,
  now = Date.now()
): boolean {
  if (!expected || startedAt === null) return false
  if (snapshot.error) return false
  if (now - startedAt >= MPV_STARTUP_OVERLAY_TIMEOUT_MS) return false
  // Stream is already playing — no overlay needed
  if (snapshot.timePos > 0) return false
  if (snapshot.tracks.length > 0) return false
  // MPV loaded something other than what we expected — it already moved on
  if (belongsElsewhere(snapshot, expected)) return false
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
      name: track.title || track.lang || `Ses ${audioTracks.length + 1}`,
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
      name: track.title || track.lang || `Altyazı ${subtitleTracks.length + 1}`,
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

export const MAX_AUTO_RECONNECT = 5
const RECONNECT_DELAY_MS = 1000
const STALL_THRESHOLD_MS = 12_000
export const MPV_CONNECTION_LOST_MESSAGE = 'Yayın bağlantısı kesildi.'

/**
 * Whether a polled snapshot describes the playback the renderer asked for.
 *
 * Until `mpvOpen` for the current playback has resolved, mpv may still be on
 * the previous file, and applying that snapshot writes the old stream's tracks
 * and position into the new one. A snapshot stamped with a playback id is
 * accepted only for the current one. An unstamped one falls back to the path:
 * equal to the stream just left is stale; any other path is mpv's own name for
 * ours (a resolved playlist entry, for instance) and is accepted.
 */
export function isSnapshotForCurrentStream(
  snapshot: Pick<MpvSnapshotLike, 'path' | 'playbackId'>,
  stream: { playback: MpvPlaybackRef | null; previousUrl: string | null; opened: boolean }
): boolean {
  const { playback } = stream
  if (!playback || !stream.opened) return false
  if (snapshot.playbackId) return snapshot.playbackId === playback.playbackId
  if (snapshot.path === null || snapshot.path === playback.url) return true
  return snapshot.path !== stream.previousUrl
}

export interface MpvReconnectInput {
  isLive: boolean
  error: string | null
  isStalled: boolean
  /** A stream is loaded and no reconnect is already scheduled. */
  canReconnect: boolean
  attempts: number
  currentPlayerError: string | null
}

export function planMpvReconnect(input: MpvReconnectInput): {
  scheduleAttempt: number | null
  playerError: string | null
} {
  if (!input.error && !input.isStalled) return { scheduleAttempt: null, playerError: null }
  if (!input.canReconnect) {
    return { scheduleAttempt: null, playerError: input.currentPlayerError }
  }
  if (input.isLive && input.attempts < MAX_AUTO_RECONNECT) {
    const attempt = input.attempts + 1
    return {
      scheduleAttempt: attempt,
      playerError: `Bağlantı kesildi, yeniden bağlanılıyor... (${attempt}/${MAX_AUTO_RECONNECT})`
    }
  }
  // Out of attempts. A stall carries no mpv error text, and keeping the last
  // "(5/5)" progress message would claim a reconnect is still under way.
  return { scheduleAttempt: null, playerError: input.error ?? MPV_CONNECTION_LOST_MESSAGE }
}

export interface MpvTrackSelectionState {
  audioPreferenceApplied: boolean
  subtitlePreferenceApplied: boolean
  /** The "subtitles on by default" setting is off and was applied to this stream. */
  subtitlesOffByDefault: boolean
}

export interface MpvTrackSelectionStore {
  currentAudioTrack: string | null
  currentSubtitleTrack: string | null
  isSubtitleTrackUserChoice: boolean
  settings: {
    preferredAudioLanguage: string
    preferredSubtitleLanguage: string
    defaultSubtitleEnabled: boolean
  }
}

export interface MpvTrackSelectionResult {
  audioTracks: AudioTrack[]
  subtitleTracks: SubtitleTrack[]
  /** `undefined` leaves the store's selection alone. */
  audioTrack?: string | null
  subtitleTrack?: string | null
  /** mpv picked a subtitle on its own although the setting says off. */
  disableMpvSubtitles: boolean
  state: MpvTrackSelectionState
}

/**
 * Decides the store's audio/subtitle selection from one mpv snapshot.
 *
 * Preferences are consumed once per stream, and only when the snapshot carries
 * the stream's track list: consuming them on an empty list (mpv still opening)
 * used to burn the subtitle preference before there was anything to match.
 * After that, the store is only back-filled from mpv when it holds no choice,
 * and never over a choice the viewer made: the poll that follows "off" can
 * still report the old `sid` and would switch the subtitle back on.
 */
export function reconcileMpvTrackSelection(
  snapshot: Pick<MpvStateSnapshot, 'tracks' | 'aid' | 'sid'>,
  store: MpvTrackSelectionStore,
  state: MpvTrackSelectionState
): MpvTrackSelectionResult {
  const audioTracks = mapAudioTracks(snapshot.tracks)
  const subtitleTracks = mapSubtitleTracks(snapshot.tracks)
  const nextState = { ...state }
  const result: MpvTrackSelectionResult = {
    audioTracks,
    subtitleTracks,
    disableMpvSubtitles: false,
    state: nextState
  }

  const selectedAudioTrack = snapshot.aid ? `${MPV_AUDIO_TRACK_PREFIX}${snapshot.aid}` : null
  if (!state.audioPreferenceApplied && audioTracks.length > 0) {
    const preferredTrackId = pickPreferredAudioTrackId(
      audioTracks,
      store.settings.preferredAudioLanguage
    )
    const targetAudioTrack = preferredTrackId ?? selectedAudioTrack
    if (targetAudioTrack && store.currentAudioTrack !== targetAudioTrack) {
      result.audioTrack = targetAudioTrack
    } else if (!targetAudioTrack && store.currentAudioTrack !== null) {
      result.audioTrack = null
    }
    nextState.audioPreferenceApplied = true
  } else if (selectedAudioTrack && store.currentAudioTrack === null) {
    result.audioTrack = selectedAudioTrack
  }

  const selectedSubtitleTrack = snapshot.sid ? `${MPV_SUBTITLE_TRACK_PREFIX}${snapshot.sid}` : null
  const streamLoaded = snapshot.tracks.length > 0
  if (!state.subtitlePreferenceApplied) {
    if (store.isSubtitleTrackUserChoice) {
      // The viewer already decided for this stream; nothing left to prefer.
      nextState.subtitlePreferenceApplied = true
    } else if (streamLoaded) {
      const { defaultSubtitleEnabled, preferredSubtitleLanguage } = store.settings
      if (!defaultSubtitleEnabled || subtitleTracks.length === 0) {
        if (store.currentSubtitleTrack !== null) result.subtitleTrack = null
        if (!defaultSubtitleEnabled) {
          nextState.subtitlesOffByDefault = true
          result.disableMpvSubtitles = selectedSubtitleTrack !== null
        }
      } else {
        const preferredTrackId = pickPreferredSubtitleTrackId(
          subtitleTracks,
          preferredSubtitleLanguage
        )
        const targetSubtitleTrack = preferredTrackId ?? selectedSubtitleTrack
        if (targetSubtitleTrack && store.currentSubtitleTrack !== targetSubtitleTrack) {
          result.subtitleTrack = targetSubtitleTrack
        } else if (!targetSubtitleTrack && store.currentSubtitleTrack !== null) {
          result.subtitleTrack = null
        }
      }
      nextState.subtitlePreferenceApplied = true
    }
  } else if (
    selectedSubtitleTrack &&
    store.currentSubtitleTrack === null &&
    !store.isSubtitleTrackUserChoice &&
    !state.subtitlesOffByDefault
  ) {
    result.subtitleTrack = selectedSubtitleTrack
  }

  return result
}

export function useMpvPlayer(enabled: boolean) {
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const trackSelectionRef = useRef<MpvTrackSelectionState>({
    audioPreferenceApplied: false,
    subtitlePreferenceApplied: false,
    subtitlesOffByDefault: false
  })
  // The playback mpv was last asked to open, and the URL of the one before it.
  const startupRef = useRef<MpvPlaybackRef | null>(null)
  const previousStreamUrlRef = useRef<string | null>(null)
  // The playback being loaded; `openedPlaybackIdRef` catches up once mpv has
  // accepted it. Polls only trust snapshots taken after that.
  const requestedPlaybackIdRef = useRef<string | null>(null)
  const openedPlaybackIdRef = useRef<string | null>(null)
  const startupStartedAtRef = useRef<number | null>(null)
  const reconnectCountRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGoodPlaybackRef = useRef(0)
  const startupVisibleRef = useRef(false)
  const [isStartupVisible, setIsStartupVisible] = useState(false)
  // Select individually: a bare `useStore()` re-runs this hook on every store
  // write, and the poll below writes several times per second.
  const currentPlayback = useStore((s) => s.currentPlayback)
  const playbackId = currentPlayback?.playbackId ?? null
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
    trackSelectionRef.current = {
      audioPreferenceApplied: false,
      subtitlePreferenceApplied: false,
      subtitlesOffByDefault: false
    }
  }, [enabled, mediaKey])

  const cancelPendingReconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }

  // Full MPV teardown when disabled or component unmounts
  useEffect(() => {
    const teardown = () => {
      startupRef.current = null
      previousStreamUrlRef.current = null
      requestedPlaybackIdRef.current = null
      openedPlaybackIdRef.current = null
      startupStartedAtRef.current = null
      reconnectCountRef.current = 0
      cancelPendingReconnect()
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

  // Declared ahead of the channel-sync effect on purpose: effects run in
  // declaration order, so the controller learns the user's choice before mpv is
  // ever launched. That matters because the failure this setting exists to
  // escape — a driver that black-screens on hardware decoding — would otherwise
  // happen during the moment mpv starts with the default and gets corrected.
  useEffect(() => {
    if (!enabled) return
    void mpvSetHardwareDecoding(settings.hardwareAcceleration).catch(() => undefined)
  }, [enabled, settings.hardwareAcceleration])

  useEffect(() => {
    if (!enabled) return
    void mpvSetAudioPassthrough(settings.audioPassthrough).catch(() => undefined)
  }, [enabled, settings.audioPassthrough])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // A reconnect scheduled for the previous stream (or the previous load of
    // this one) must not fire into this one, and its attempt count and stall
    // clock belong to it too.
    cancelPendingReconnect()
    reconnectCountRef.current = 0
    lastGoodPlaybackRef.current = 0
    const playback = currentPlayback
    requestedPlaybackIdRef.current = playback?.playbackId ?? null

    const syncChannel = async () => {
      const available = await mpvIsAvailable()
      if (cancelled) return

      if (!available) {
        startupRef.current = null
        startupStartedAtRef.current = null
        updateStartupVisibility(false)
        setPlaybackEngine('html5')
        return
      }

      setPlaybackEngine('mpv')

      if (!playback) {
        startupRef.current = null
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
        const previous = startupRef.current
        const isFirstLaunch = !previous
        // Only an unstamped snapshot is judged by its path, and the path of a
        // reloaded stream is not stale.
        if (previous && previous.url !== playback.streamUrl) {
          previousStreamUrlRef.current = previous.url
        }
        startupRef.current = { playbackId: playback.playbackId, url: playback.streamUrl }
        startupStartedAtRef.current = Date.now()
        if (isFirstLaunch) updateStartupVisibility(true)
        await mpvOpen(playback.streamUrl)
        if (cancelled) return
        openedPlaybackIdRef.current = playback.playbackId

        await Promise.allSettled([mpvSetVolume(safeVolume), mpvSetMute(currentMuted)])
      } catch (error) {
        if (cancelled) return
        startupRef.current = null
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
    // `currentPlayback` changes only with a new playback id: a start, a reload
    // ("Yeniden Bağlan" loads the same stream again) or a return from the mini card.
  }, [enabled, currentPlayback, applyPlayerPatch, setPlaybackEngine, setPlayerError])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // mpv answers slowly while it is opening a stream; without this, ticks pile
    // up behind one another and land out of order.
    let pollInFlight = false

    const pollOnce = async () => {
      const requested = requestedPlaybackIdRef.current
      const opened = requested !== null && openedPlaybackIdRef.current === requested
      const [snapshot, windowFullscreen] = await Promise.all([
        mpvGetState().catch((): MpvSnapshotLike | null => null),
        windowIsFullscreen().catch(() => false)
      ])
      if (cancelled || !snapshot) return

      const now = Date.now()
      // Poll can only CLEAR the startup overlay, never re-enable it
      if (startupVisibleRef.current && !shouldKeepStartupOverlay(snapshot, startupRef.current, startupStartedAtRef.current, now)) {
        updateStartupVisibility(false)
      }

      // The playback changed while this request was out, or mpv has not taken
      // the current one yet: the snapshot belongs to something else.
      if (requestedPlaybackIdRef.current !== requested) return
      if (
        !isSnapshotForCurrentStream(snapshot, {
          playback: startupRef.current,
          previousUrl: previousStreamUrlRef.current,
          opened
        })
      ) {
        return
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
      // mpv has this playback's file open far enough to seek: a resume may run.
      if (duration > 0 && requested && store.loadedPlaybackId !== requested) {
        patch.loadedPlaybackId = requested
      }

      const cacheDuration = snapshot.demuxerCacheDuration || 0
      if (store.demuxerCacheDuration !== cacheDuration) patch.demuxerCacheDuration = cacheDuration

      const fullscreen = Boolean(windowFullscreen || snapshot.fullscreen)
      if (store.isFullscreen !== fullscreen) patch.isFullscreen = fullscreen

      if (store.passthroughActive !== snapshot.passthroughActive) {
        patch.passthroughActive = snapshot.passthroughActive
      }

      // time-pos is unreliable as a liveness signal: many IPTV live streams
      // (proxied TS, HLS at segment boundaries, DVR-less feeds) hold it steady
      // or reset it while still healthily delivering frames. Trust mpv's own
      // demuxer underrun flag instead — it flips true only when the cache is
      // actually empty and no packets are arriving. The 12s threshold gives
      // mpv's own reconnect (reconnect_delay_max=5s) two attempts before we
      // forcibly reload.
      const isLiveStream = store.currentPlayback ? isLiveTarget(store.currentPlayback.target) : false
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

      // Auto-reconnect on error OR stall for live streams. A reconnect reopens
      // the same playback (no new id) and is dropped if another one has
      // started by the time it fires.
      const reconnectFor = startupRef.current
      const reconnect = planMpvReconnect({
        isLive: isLiveStream,
        error: snapshot.error,
        isStalled: isStalledLive,
        canReconnect: !!reconnectFor && !reconnectTimerRef.current,
        attempts: reconnectCountRef.current,
        currentPlayerError: store.playerError
      })
      if (reconnect.scheduleAttempt !== null && reconnectFor) {
        reconnectCountRef.current = reconnect.scheduleAttempt
        lastGoodPlaybackRef.current = now // reset stall timer
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          if (startupRef.current?.playbackId !== reconnectFor.playbackId) return
          void mpvOpen(reconnectFor.url).catch(() => undefined)
        }, RECONNECT_DELAY_MS * reconnect.scheduleAttempt)
      }
      if (store.playerError !== reconnect.playerError) patch.playerError = reconnect.playerError

      const selection = reconcileMpvTrackSelection(snapshot, store, trackSelectionRef.current)
      trackSelectionRef.current = selection.state
      if (!sameAudioTracks(store.audioTracks, selection.audioTracks)) {
        patch.audioTracks = selection.audioTracks
      }
      if (selection.audioTrack !== undefined) patch.currentAudioTrack = selection.audioTrack
      if (!sameSubtitleTracks(store.subtitleTracks, selection.subtitleTracks)) {
        patch.subtitleTracks = selection.subtitleTracks
      }
      if (selection.subtitleTrack !== undefined) patch.currentSubtitleTrack = selection.subtitleTrack
      if (selection.disableMpvSubtitles) {
        void mpvSetSubtitleTrack(null).catch(() => undefined)
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

    const poll = async () => {
      if (pollInFlight) return
      pollInFlight = true
      try {
        await pollOnce()
      } finally {
        pollInFlight = false
      }
    }

    void poll()
    pollTimerRef.current = setInterval(() => {
      void poll()
    }, 250)

    return () => {
      cancelled = true
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      // poll() schedules this one, so this effect owns it too. The teardown
      // effect also clears it, but relying on that split ownership means a
      // reconnect can still fire after this effect stopped polling.
      cancelPendingReconnect()
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

  // Also re-sent for every playback: mpv keeps audio-delay/sub-delay/speed across
  // loadfile, so the store resetting to defaults has to be pushed down or the
  // previous stream's correction stays applied to the new one.
  useEffect(() => {
    if (!enabled) return
    void mpvSetPlaybackTuning(playbackTuning).catch(() => undefined)
  }, [enabled, playbackTuning, playbackId])

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

  return enabled && startupRef.current !== null && isStartupVisible
}
