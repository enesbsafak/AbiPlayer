import { useEffect, useRef, type RefObject } from 'react'
import type Hls from 'hls.js'
import { useStore } from '@/store'
import type { SubtitleTrack } from '@/types/player'
import { cancelAllMediaJobs } from '@/services/platform'
import { AUTO_VIDEO_QUALITY_ID, getVideoQualityLevelIndex } from '@/services/quality'
import { isLiveTarget } from '../../../shared/playback'
import { isHlsJsSupported, isHlsOrTsUrl, startHlsEngine, type HlsEngine } from '@/player/hls-engine'
import {
  planDirectReadRetry,
  playDirectSource,
  probeBeforePlayback,
  releaseMediaElementSource
} from '@/player/direct-playback'
import { activeCuesAt, loadEmbeddedSubtitle } from '@/player/embedded-subtitles'
import { createHtml5TrackSync } from '@/player/html5-track-sync'
import { watchHtml5LiveStream } from '@/player/html5-live-watch'
import {
  applyHlsSubtitleTrack,
  applyNativeAudioTrack,
  applyNativeSubtitleTrack,
  attachCueListeners,
  collectProbedSubtitleTracks,
  disableAllNativeSubtitleTracks,
  disableHlsSubtitles,
  getNativeAudioTracks,
  mergeHtml5SubtitleTracks,
  syncActiveSubtitleCues
} from '@/player/html5-tracks'
import { createMediaJobScope } from '@/player/media-jobs'
import { wireMediaElementEvents } from '@/player/media-events'
import {
  EXTERNAL_SUBTITLE_ID,
  HLS_AUDIO_PREFIX,
  HLS_SUBTITLE_PREFIX,
  NATIVE_AUDIO_PREFIX,
  NATIVE_SUBTITLE_PREFIX,
  PROBED_SUBTITLE_PREFIX,
  legacyTrackIndex,
  trackId,
  trackIndex
} from '@/player/track-ids'
import { FRESH_TRACK_PREFERENCES, type TrackPreferenceState } from '@/player/track-reconciler'

export {
  HLS_MAX_CONSECUTIVE_FATAL_ERRORS,
  createHlsErrorRecovery,
  type HlsRecoveryStep
} from '@/player/hls-engine'
export { SUBTITLE_PROBE_TIMEOUT_MS, releaseMediaElementSource, waitAtMost } from '@/player/direct-playback'
export { TRUNCATED_SUBTITLE_NOTICE, isTruncatedSubtitleExtraction } from '@/player/embedded-subtitles'

const HLS_SUBTITLE_RETRY_ATTEMPTS = 8
const HLS_SUBTITLE_RETRY_STEP_MS = 250
const PARSED_CUE_TICK_MS = 100
export const HLS_LOAD_FAILED_MESSAGE = 'Oynatıcı bileşeni yüklenemedi.'

/**
 * The HTML5 engine: hls.js or the `<video>` element playing the current
 * playback, its tracks mirrored into the store and the store's selections
 * applied back. The work is done by the modules under `@/player`; this hook
 * only ties them to the playback's lifetime.
 */
export function usePlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  options?: { disabled?: boolean }
) {
  const disabled = options?.disabled ?? false
  const hlsRef = useRef<Hls | null>(null)
  const engineRef = useRef<HlsEngine | null>(null)
  const directReadRetriesRef = useRef(0)
  const preferencesRef = useRef<TrackPreferenceState>(FRESH_TRACK_PREFERENCES)

  // Select individually: a bare `useStore()` re-runs this hook on every store
  // write, and playback pushes several per second.
  // Each start, reload and return from the mini card is a new playback id;
  // the URL and the live flag never change within one.
  const playbackId = useStore((s) => s.currentPlayback?.playbackId ?? null)
  const streamUrl = useStore((s) => s.currentPlayback?.streamUrl ?? null)
  const isLive = useStore((s) => (s.currentPlayback ? isLiveTarget(s.currentPlayback.target) : false))
  const mediaKey = useStore((s) => s.currentPlayback?.mediaKey ?? null)
  const markPlaybackLoaded = useStore((s) => s.markPlaybackLoaded)
  const volume = useStore((s) => s.volume)
  const isMuted = useStore((s) => s.isMuted)
  const currentAudioTrack = useStore((s) => s.currentAudioTrack)
  const currentSubtitleTrack = useStore((s) => s.currentSubtitleTrack)
  const currentVideoQuality = useStore((s) => s.currentVideoQuality)
  const subtitleCues = useStore((s) => s.subtitleCues)
  const setActiveSubtitleCues = useStore((s) => s.setActiveSubtitleCues)
  const applyPlayerPatch = useStore((s) => s.applyPlayerPatch)

  // Track preferences are applied once per item, not again on a reload.
  useEffect(() => {
    preferencesRef.current = FRESH_TRACK_PREFERENCES
  }, [mediaKey])

  // A probe or extraction still running when the player goes away is killed in main.
  useEffect(() => () => void cancelAllMediaJobs().catch(() => undefined), [])

  // Engine lifecycle: one run per playback.
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video || !playbackId) return
    directReadRetriesRef.current = 0

    const url = streamUrl
    if (!url) return
    let disposed = false
    // Results that arrive late (the subtitle probe) are applied only to the
    // playback they were started for.
    const isCurrentPlayback = () => !disposed && useStore.getState().currentPlayback?.playbackId === playbackId
    const jobs = createMediaJobScope()
    let probedTracks: SubtitleTrack[] = []
    let engine: HlsEngine | null = null
    // `{ once: true }` only self-removes AFTER the event fires. Switching
    // channels before `loadedmetadata` arrives left the previous run's handler
    // attached, so it fired on the NEW source and wrote the OLD channel's
    // track state. Abort them on cleanup.
    const listenerAbort = new AbortController()

    hlsRef.current?.destroy()
    hlsRef.current = null
    engineRef.current = null

    const tracks = createHtml5TrackSync({
      video,
      getHls: () => hlsRef.current,
      getProbedTracks: () => probedTracks,
      getStore: () => useStore.getState(),
      applyPlayerPatch,
      setActiveSubtitleCues,
      preferences: preferencesRef
    })

    const textTrackList = video.textTracks
    const nativeAudioTracks = getNativeAudioTracks(video)
    const onAudioTrackListChange = () => tracks.refreshAudioTracks()
    const onMediaTracksMaybeReady = () => tracks.refreshMediaTracks()
    const onTextTrackListChange = () => tracks.onTextTracksChanged()

    for (const type of ['addtrack', 'removetrack', 'change'] as const) {
      if (typeof textTrackList.addEventListener === 'function') {
        textTrackList.addEventListener(type, onTextTrackListChange, { signal: listenerAbort.signal })
      }
      nativeAudioTracks?.addEventListener?.(type, onAudioTrackListChange)
    }
    video.addEventListener('loadeddata', onMediaTracksMaybeReady, { signal: listenerAbort.signal })
    video.addEventListener('canplay', onMediaTracksMaybeReady, { signal: listenerAbort.signal })
    // Every load of this playback: the first, the direct-read retry and the
    // live reconnect of a plain source all start on the default audio.
    video.addEventListener('loadedmetadata', () => tracks.reassertAudioSelection(), { signal: listenerAbort.signal })

    const resetQualities = () =>
      applyPlayerPatch({ videoQualityOptions: [], currentVideoQuality: null, activeVideoQuality: null })
    resetQualities()

    const onMetadata = () => {
      tracks.refreshAudioTracks(null)
      tracks.refreshSubtitleTracks(null)
      attachCueListeners(video, setActiveSubtitleCues)
    }

    if (isHlsOrTsUrl(url)) {
      if (isHlsJsSupported()) {
        // hls.js is loaded on demand; a playback that ended meanwhile aborts
        // the start (listenerAbort), and nothing is created for it.
        void startHlsEngine(
          video,
          url,
          {
            manifestParsed: (hls) => {
              tracks.refreshVideoQualities(hls)
              tracks.refreshAudioTracks(hls)
              tracks.reassertAudioSelection(hls)
              tracks.refreshSubtitleTracks(hls)
              attachCueListeners(video, setActiveSubtitleCues)
              tracks.syncHlsSubtitleSelection()
            },
            levelsChanged: (hls) => tracks.refreshVideoQualities(hls),
            audioTracksChanged: (hls) => tracks.refreshAudioTracks(hls),
            audioTrackSwitched: (hls) => {
              tracks.refreshAudioTracks(hls)
              const active = trackId(HLS_AUDIO_PREFIX, hls.audioTrack)
              if (useStore.getState().currentAudioTrack !== active) applyPlayerPatch({ currentAudioTrack: active })
            },
            subtitleTracksChanged: (hls) => {
              tracks.refreshSubtitleTracks(hls)
              attachCueListeners(video, setActiveSubtitleCues)
              tracks.syncHlsSubtitleSelection()
            },
            subtitleTrackSwitched: (hls) => {
              tracks.refreshSubtitleTracks(hls)
              attachCueListeners(video, setActiveSubtitleCues)
              tracks.syncHlsSubtitleSelection()
              syncActiveSubtitleCues(video, setActiveSubtitleCues)
            },
            failed: (message) => applyPlayerPatch({ playerError: message })
          },
          { signal: listenerAbort.signal }
        ).then(
          (started) => {
            if (!started) return
            if (disposed) {
              // Cleaned up between hls.js being created and this callback.
              started.dispose()
              return
            }
            engine = started
            engineRef.current = started
            hlsRef.current = started.hls
          },
          () => {
            if (!disposed) applyPlayerPatch({ playerError: HLS_LOAD_FAILED_MESSAGE })
          }
        )
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        playDirectSource(
          video,
          url,
          () => {
            resetQualities()
            onMetadata()
          },
          listenerAbort.signal
        )
      }
    } else {
      // Direct playback (mp4, mkv, etc.)
      const startDirectPlayback = () => {
        resetQualities()
        playDirectSource(
          video,
          url,
          () => {
            onMetadata()
            syncActiveSubtitleCues(video, setActiveSubtitleCues)
          },
          listenerAbort.signal
        )
      }

      if (isLive) {
        startDirectPlayback()
      } else {
        // Probe direct VOD streams before playback starts to avoid concurrent
        // connections that can exceed provider max-connection limits.
        void probeBeforePlayback({
          probe: () => jobs.probe(url),
          isCurrent: isCurrentPlayback,
          onTracks: (found, late) => {
            probedTracks = collectProbedSubtitleTracks(found)
            if (late) tracks.refreshSubtitleTracks(null)
            else applyPlayerPatch({ subtitleTracks: mergeHtml5SubtitleTracks([], [], probedTracks) })
          },
          startPlayback: startDirectPlayback
        })
      }
    }

    return () => {
      disposed = true
      jobs.cancel()
      listenerAbort.abort()
      for (const type of ['addtrack', 'removetrack', 'change'] as const) {
        nativeAudioTracks?.removeEventListener?.(type, onAudioTrackListChange)
      }
      disableAllNativeSubtitleTracks(video)
      engine?.dispose()
      if (engineRef.current === engine) engineRef.current = null
      hlsRef.current = null
      releaseMediaElementSource(video)
    }
  }, [
    // A reload issues a new playback id, which is how "Yeniden Bağlan" reloads.
    playbackId,
    streamUrl,
    isLive,
    videoRef,
    setActiveSubtitleCues,
    applyPlayerPatch,
    disabled
  ])

  // Volume sync
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = isMuted
  }, [volume, isMuted, videoRef, disabled, playbackId])

  // Audio track switching
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video || !currentAudioTrack) return
    const hls = hlsRef.current

    const hlsIndex = trackIndex(currentAudioTrack, HLS_AUDIO_PREFIX)
    if (currentAudioTrack.startsWith(HLS_AUDIO_PREFIX)) {
      if (hlsIndex !== null && hls) hls.audioTrack = hlsIndex
      return
    }

    if (currentAudioTrack.startsWith(NATIVE_AUDIO_PREFIX)) {
      const nativeIndex = trackIndex(currentAudioTrack, NATIVE_AUDIO_PREFIX)
      if (nativeIndex !== null) applyNativeAudioTrack(video, nativeIndex)
      return
    }

    // Backward compatibility for old persisted numeric IDs
    const legacyIndex = legacyTrackIndex(currentAudioTrack)
    if (legacyIndex !== null) {
      if (hls) hls.audioTrack = legacyIndex
      else applyNativeAudioTrack(video, legacyIndex)
    }
  }, [currentAudioTrack, videoRef, disabled])

  // Video quality switching via HLS.js
  useEffect(() => {
    if (disabled) return
    const hls = hlsRef.current
    if (!hls || !currentVideoQuality) return

    if (currentVideoQuality === AUTO_VIDEO_QUALITY_ID) {
      if (!hls.autoLevelEnabled || hls.nextLevel !== -1) hls.nextLevel = -1
      return
    }

    const levelIndex = getVideoQualityLevelIndex(currentVideoQuality)
    if (levelIndex === null || !hls.levels[levelIndex]) return
    if (hls.autoLevelEnabled || hls.nextLevel !== levelIndex) hls.nextLevel = levelIndex
  }, [currentVideoQuality, disabled])

  // Subtitle track switching via HLS.js/native tracks
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video) return
    const hls = hlsRef.current
    let cancelled = false
    const retryTimers: number[] = []
    const clearRetries = () => {
      for (const timer of retryTimers) window.clearTimeout(timer)
    }

    if (currentSubtitleTrack === null || currentSubtitleTrack === EXTERNAL_SUBTITLE_ID) {
      disableHlsSubtitles(hls)
      disableAllNativeSubtitleTracks(video)
      if (currentSubtitleTrack === null) applyPlayerPatch({ subtitleCues: [], activeSubtitleCues: [] })
      return
    }

    if (currentSubtitleTrack.startsWith(PROBED_SUBTITLE_PREFIX)) {
      disableHlsSubtitles(hls)
      disableAllNativeSubtitleTracks(video)
      applyPlayerPatch({ subtitleCues: [], activeSubtitleCues: [] })

      const streamIndex = trackIndex(currentSubtitleTrack, PROBED_SUBTITLE_PREFIX)
      if (streamIndex === null || !streamUrl || !playbackId) return

      // Choosing another subtitle, or another playback, kills the extraction.
      const jobs = createMediaJobScope()
      void loadEmbeddedSubtitle(
        () => jobs.extract(streamUrl, streamIndex),
        () => !cancelled && useStore.getState().currentPlayback?.playbackId === playbackId
      ).then((outcome) => {
        switch (outcome.kind) {
          case 'cues':
            applyPlayerPatch(
              outcome.notice ? { subtitleCues: outcome.cues, playerNotice: outcome.notice } : { subtitleCues: outcome.cues }
            )
            return
          case 'empty':
            applyPlayerPatch({ subtitleCues: [] })
            return
          case 'failed':
            console.warn('Failed to extract embedded subtitle track', outcome.error)
            return
          case 'stale':
            return
        }
      })

      return () => {
        cancelled = true
        jobs.cancel()
      }
    }

    if (currentSubtitleTrack.startsWith(HLS_SUBTITLE_PREFIX)) {
      applyPlayerPatch({ subtitleCues: [], activeSubtitleCues: [] })

      const index = trackIndex(currentSubtitleTrack, HLS_SUBTITLE_PREFIX)
      if (index !== null && hls && !applyHlsSubtitleTrack(video, hls, index, setActiveSubtitleCues)) {
        // hls.js creates the element's text track a little later.
        for (let attempt = 1; attempt <= HLS_SUBTITLE_RETRY_ATTEMPTS; attempt++) {
          retryTimers.push(
            window.setTimeout(() => {
              if (cancelled) return
              if (applyHlsSubtitleTrack(video, hls, index, setActiveSubtitleCues)) clearRetries()
            }, attempt * HLS_SUBTITLE_RETRY_STEP_MS)
          )
        }
      }

      return () => {
        cancelled = true
        clearRetries()
      }
    }

    if (currentSubtitleTrack.startsWith(NATIVE_SUBTITLE_PREFIX)) {
      applyPlayerPatch({ subtitleCues: [] })
      const nativeIndex = trackIndex(currentSubtitleTrack, NATIVE_SUBTITLE_PREFIX)
      if (nativeIndex !== null) {
        disableHlsSubtitles(hls)
        applyNativeSubtitleTrack(video, nativeIndex)
        syncActiveSubtitleCues(video, setActiveSubtitleCues)
      }
      return
    }

    // Backward compatibility for old persisted numeric IDs
    const legacyIndex = legacyTrackIndex(currentSubtitleTrack)
    if (legacyIndex !== null && hls) {
      applyPlayerPatch({ subtitleCues: [], activeSubtitleCues: [] })
      applyHlsSubtitleTrack(video, hls, legacyIndex, setActiveSubtitleCues)
    }
  }, [currentSubtitleTrack, playbackId, streamUrl, videoRef, setActiveSubtitleCues, applyPlayerPatch, disabled])

  // Media element events
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video) return

    return wireMediaElementEvents(video, (signal) => ({
      play: () => applyPlayerPatch({ isPlaying: true, isPaused: false }),
      pause: () => applyPlayerPatch({ isPaused: true }),
      waiting: () => applyPlayerPatch({ isBuffering: true }),
      playing: () => applyPlayerPatch({ isBuffering: false, playerError: null }),
      timeupdate: () => applyPlayerPatch({ currentTime: video.currentTime }),
      durationchange: () => {
        applyPlayerPatch({ duration: video.duration })
        // The element has this playback's metadata: a resume seek can land now.
        if (playbackId && Number.isFinite(video.duration) && video.duration > 0) markPlaybackLoaded(playbackId)
      },
      error: () => {
        const message = video.error?.message || 'Oynatma hatası'
        const retry = planDirectReadRetry({
          streamUrl,
          message,
          retries: directReadRetriesRef.current,
          currentTime: video.currentTime
        })
        const src = video.currentSrc || streamUrl
        if (!retry || !src) {
          applyPlayerPatch({ playerError: message })
          return
        }

        directReadRetriesRef.current += 1
        applyPlayerPatch({ playerError: null, isBuffering: true })
        video.pause()
        video.src = src
        // Bound to this effect: it would otherwise seek the next channel to
        // this one's position.
        video.addEventListener(
          'loadedmetadata',
          () => {
            if (retry.resumeAt > 1) {
              try {
                video.currentTime = Math.max(0, retry.resumeAt - 0.25)
              } catch {
                // The element may already be resetting; playback resumes from 0.
              }
            }
            video.play().catch(() => {})
          },
          { once: true, signal }
        )
        video.load()
      }
    }))
  }, [videoRef, playbackId, streamUrl, applyPlayerPatch, markPlaybackLoaded, disabled])

  // Live streams: the shared reconnect policy recovers a frozen stream.
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video || !playbackId || !isLive) return

    return watchHtml5LiveStream(video, {
      showMessage: (message) => applyPlayerPatch({ playerError: message }),
      reconnect: () => {
        const engine = engineRef.current
        if (engine) {
          // The playlist again, not `startLoad`: after a fatal manifest
          // failure hls.js has nothing left to resume from.
          engine.reload()
          return
        }
        const src = video.currentSrc || streamUrl
        if (src) {
          video.src = src
          video.play().catch(() => {})
        }
      }
    })
  }, [playbackId, isLive, streamUrl, videoRef, applyPlayerPatch, disabled])

  // Cue matching for parsed subtitle sources (external files + extracted embedded tracks)
  useEffect(() => {
    if (disabled) return
    const isParsedSubtitleSource =
      currentSubtitleTrack === EXTERNAL_SUBTITLE_ID ||
      (typeof currentSubtitleTrack === 'string' && currentSubtitleTrack.startsWith(PROBED_SUBTITLE_PREFIX))

    if (!isParsedSubtitleSource || subtitleCues.length === 0) {
      if (!isParsedSubtitleSource) setActiveSubtitleCues([])
      return
    }

    const interval = window.setInterval(() => {
      const video = videoRef.current
      if (video) setActiveSubtitleCues(activeCuesAt(subtitleCues, video.currentTime))
    }, PARSED_CUE_TICK_MS)

    return () => window.clearInterval(interval)
  }, [currentSubtitleTrack, subtitleCues, videoRef, setActiveSubtitleCues, disabled])
}
